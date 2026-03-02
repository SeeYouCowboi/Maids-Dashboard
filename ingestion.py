#!/usr/bin/env python3
"""Periodic ingestion engine that polls data sources and indexes into dashboard.db.

Data sources:
  1. workspace/maids/state/events.jsonl  -> event_index table
  2. cron/jobs.json + cron/runs/*.jsonl  -> cron_job / cron_run tables
  3. delivery-queue/*.json               -> delivery_failure table
  4. agents/*/sessions/sessions.json     -> session_meta table

Security: MEMORY.md content is never ingested or exposed.
"""

from __future__ import annotations

import glob
import json
import logging
import os
import threading
import time
from typing import Any

from dashboard_db import DashboardDB  # pyright: ignore[reportImplicitRelativeImport]

logger = logging.getLogger(__name__)

# Security: never ingest these filenames
_BLOCKED_BASENAMES = frozenset({"MEMORY.md"})


def _is_blocked_path(path: str) -> bool:
    """Reject any path whose basename is in the blocklist."""
    return os.path.basename(path) in _BLOCKED_BASENAMES


class IngestionEngine:
    """Periodically polls data sources and indexes them into dashboard.db."""

    def __init__(
        self,
        db: DashboardDB,
        openclaw_root: str,
        *,
        poll_interval: float = 1.0,
        sse_manager: Any = None,
    ) -> None:
        self._db = db
        self._root = openclaw_root
        self._poll_interval = poll_interval
        self._sse_manager = sse_manager
        self._shutdown = threading.Event()
        self._thread: threading.Thread | None = None

    # ── lifecycle ──────────────────────────────────────────────

    def start(self) -> None:
        """Start the background ingestion thread (idempotent)."""
        if self._thread is not None and self._thread.is_alive():
            return
        self._shutdown.clear()
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="ingestion-engine"
        )
        self._thread.start()
        logger.info("ingestion engine started (interval=%.1fs)", self._poll_interval)

    def stop(self, timeout: float = 5.0) -> None:
        """Signal shutdown and wait for the background thread to finish."""
        self._shutdown.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
        logger.info("ingestion engine stopped")

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    # ── offset helpers ─────────────────────────────────────────

    def _get_offset(self, source: str) -> int:
        with self._db.get_connection() as conn:
            row = conn.execute(
                "SELECT value FROM ingest_offset WHERE source=?", (source,)
            ).fetchone()
            return int(row["value"]) if row else 0

    def _set_offset(self, source: str, value: int) -> None:
        with self._db.get_connection() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO ingest_offset(source, value) VALUES(?, ?)",
                (source, value),
            )
            conn.commit()

    # ── main loop ──────────────────────────────────────────────

    def _loop(self) -> None:
        # Ensure extra tables exist before first tick
        self._ensure_tables()
        while not self._shutdown.is_set():
            try:
                self._tick()
            except Exception:
                logger.exception("ingestion tick failed")
            self._shutdown.wait(self._poll_interval)

    def _tick(self) -> None:
        """Run one ingestion cycle across all sources."""
        n = self._ingest_events()
        if n and self._sse_manager is not None:
            self._sse_manager.broadcast("event_index.new", {"count": n})
        if self._shutdown.is_set():
            return
        n = self._ingest_cron_jobs()
        if n and self._sse_manager is not None:
            self._sse_manager.broadcast("cron.updated", {"count": n})
        if self._shutdown.is_set():
            return
        n = self._ingest_delivery_failures()
        if n and self._sse_manager is not None:
            self._sse_manager.broadcast("delivery.updated", {"count": n})
        if self._shutdown.is_set():
            return
        n = self._ingest_sessions()
        if n and self._sse_manager is not None:
            self._sse_manager.broadcast("sessions.updated", {"count": n})

    def _ensure_tables(self) -> None:
        """Create ingestion-specific tables if they don't already exist."""
        with self._db.get_connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS cron_job(
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    agent_id TEXT,
                    enabled INTEGER,
                    schedule_json TEXT,
                    state_json TEXT,
                    job_json TEXT
                );

                CREATE TABLE IF NOT EXISTS cron_run(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT,
                    ts_ms INTEGER,
                    action TEXT,
                    status TEXT,
                    run_json TEXT
                );

                CREATE TABLE IF NOT EXISTS delivery_failure(
                    id TEXT PRIMARY KEY,
                    enqueued_at INTEGER,
                    channel TEXT,
                    recipient TEXT,
                    retry_count INTEGER,
                    last_error TEXT,
                    payload_json TEXT
                );

                CREATE TABLE IF NOT EXISTS session_meta(
                    session_key TEXT PRIMARY KEY,
                    agent_id TEXT,
                    session_id TEXT,
                    model TEXT,
                    provider TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    total_tokens INTEGER,
                    context_tokens INTEGER,
                    updated_at INTEGER,
                    meta_json TEXT
                );
                """
            )
            conn.commit()

    # ── source 1: events.jsonl ─────────────────────────────────

    def _ingest_events(self) -> int:
        """Tail events.jsonl from last known byte offset into event_index."""
        source_key = "events.jsonl"
        events_path = os.path.join(
            self._root, "workspace", "maids", "state", "events.jsonl"
        )
        if not os.path.isfile(events_path):
            return 0

        offset = self._get_offset(source_key)
        try:
            file_size = os.path.getsize(events_path)
        except OSError:
            return 0

        # Handle file truncation / rotation
        if file_size < offset:
            offset = 0
        if file_size <= offset:
            return 0

        batch: list[tuple[int, str, str]] = []
        new_offset = offset

        try:
            with open(events_path, "r", encoding="utf-8") as f:
                f.seek(offset)
                remainder = ""
                while True:
                    chunk = f.read(8192)
                    if not chunk:
                        break
                    data = remainder + chunk
                    lines = data.split("\n")
                    # Last element may be a partial line; keep it for next cycle
                    remainder = lines[-1]
                    for line in lines[:-1]:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            evt = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        ts_ms = evt.get("ts_ms", 0)
                        kind = evt.get("kind", "")
                        batch.append((int(ts_ms), str(kind), line))

                # new_offset = consumed bytes (exclude partial remainder)
                new_offset = f.tell() - len(remainder.encode("utf-8"))
        except OSError:
            return 0

        if batch:
            with self._db.get_connection() as conn:
                conn.executemany(
                    "INSERT INTO event_index(ts_ms, kind, payload_json) VALUES(?, ?, ?)",
                    batch,
                )
                conn.commit()

        if new_offset != offset:
            self._set_offset(source_key, new_offset)
        return len(batch)

    # ── source 2: cron jobs + runs ─────────────────────────────

    def _ingest_cron_jobs(self) -> int:
        """Load cron/jobs.json (always) and tail cron/runs/*.jsonl."""
        jobs_path = os.path.join(self._root, "cron", "jobs.json")
        if not os.path.isfile(jobs_path):
            return 0

        # jobs.json is small — always reload in full
        try:
            with open(jobs_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return 0

        jobs = data.get("jobs", []) if isinstance(data, dict) else []
        changed_count = 0
        if jobs:
            with self._db.get_connection() as conn:
                for job in jobs:
                    if not isinstance(job, dict):
                        continue
                    job_id = job.get("id", "")
                    if not job_id:
                        continue
                    job_json = json.dumps(job, ensure_ascii=False)
                    current = conn.execute(
                        "SELECT job_json FROM cron_job WHERE id=?",
                        (job_id,),
                    ).fetchone()
                    if current and current["job_json"] == job_json:
                        continue
                    conn.execute(
                        """INSERT OR REPLACE INTO cron_job(
                               id, name, agent_id, enabled,
                               schedule_json, state_json, job_json
                           ) VALUES(?, ?, ?, ?, ?, ?, ?)""",
                        (
                            job_id,
                            job.get("name", ""),
                            job.get("agentId", ""),
                            1 if job.get("enabled") else 0,
                            json.dumps(job.get("schedule", {}), ensure_ascii=False),
                            json.dumps(job.get("state", {}), ensure_ascii=False),
                            job_json,
                        ),
                    )
                    changed_count += 1
                conn.commit()

        # Ingest run history files (offset-tracked per file)
        run_pattern = os.path.join(self._root, "cron", "runs", "*.jsonl")
        for run_file in glob.glob(run_pattern):
            if self._shutdown.is_set():
                return changed_count
            changed_count += self._ingest_cron_run_file(run_file)
        return changed_count

    def _ingest_cron_run_file(self, run_file: str) -> int:
        """Tail a single cron run JSONL file from stored offset."""
        source_key = f"cron_run:{os.path.basename(run_file)}"
        offset = self._get_offset(source_key)

        try:
            file_size = os.path.getsize(run_file)
        except OSError:
            return 0

        if file_size < offset:
            offset = 0
        if file_size <= offset:
            return 0

        batch: list[tuple[str, int, str, str, str]] = []
        new_offset = offset

        try:
            with open(run_file, "r", encoding="utf-8") as f:
                f.seek(offset)
                remainder = ""
                while True:
                    chunk = f.read(8192)
                    if not chunk:
                        break
                    data = remainder + chunk
                    lines = data.split("\n")
                    remainder = lines[-1]
                    for line in lines[:-1]:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            run = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        batch.append((
                            run.get("jobId", ""),
                            int(run.get("ts", 0)),
                            run.get("action", ""),
                            run.get("status", ""),
                            line,
                        ))

                new_offset = f.tell() - len(remainder.encode("utf-8"))
        except OSError:
            return 0

        if batch:
            with self._db.get_connection() as conn:
                conn.executemany(
                    "INSERT INTO cron_run(job_id, ts_ms, action, status, run_json) VALUES(?, ?, ?, ?, ?)",
                    batch,
                )
                conn.commit()

        if new_offset != offset:
            self._set_offset(source_key, new_offset)
        return len(batch)

    # ── source 3: delivery queue failures ──────────────────────

    def _ingest_delivery_failures(self) -> int:
        """Scan delivery-queue/*.json and index into delivery_failure table."""
        dq_dir = os.path.join(self._root, "delivery-queue")
        if not os.path.isdir(dq_dir):
            return 0

        count = 0
        with self._db.get_connection() as conn:
            for fname in os.listdir(dq_dir):
                if not fname.endswith(".json"):
                    continue
                if _is_blocked_path(fname):
                    continue
                fpath = os.path.join(dq_dir, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        item = json.load(f)
                except Exception:
                    continue

                if not isinstance(item, dict):
                    continue

                item_id = item.get("id", os.path.splitext(fname)[0])
                payload_json = json.dumps(item, ensure_ascii=False)
                current = conn.execute(
                    "SELECT payload_json FROM delivery_failure WHERE id=?",
                    (item_id,),
                ).fetchone()
                if current and current["payload_json"] == payload_json:
                    continue
                conn.execute(
                    """INSERT OR REPLACE INTO delivery_failure(
                           id, enqueued_at, channel, recipient,
                           retry_count, last_error, payload_json
                       ) VALUES(?, ?, ?, ?, ?, ?, ?)""",
                    (
                        item_id,
                        int(item.get("enqueuedAt", 0)),
                        item.get("channel", ""),
                        item.get("to", ""),
                        int(item.get("retryCount", 0)),
                        item.get("lastError", ""),
                        payload_json,
                    ),
                )
                count += 1

            conn.commit()
        return count
    # ── source 4: session metadata ─────────────────────────────

    def _ingest_sessions(self) -> int:
        """Parse agents/*/sessions/sessions.json for model, provider, tokens."""
        agents_dir = os.path.join(self._root, "agents")
        if not os.path.isdir(agents_dir):
            return 0

        count = 0
        with self._db.get_connection() as conn:
            for agent_name in os.listdir(agents_dir):
                agent_dir = os.path.join(agents_dir, agent_name)
                if not os.path.isdir(agent_dir):
                    continue

                sessions_file = os.path.join(agent_dir, "sessions", "sessions.json")
                if not os.path.isfile(sessions_file):
                    continue

                # Security: skip blocked paths
                if _is_blocked_path(sessions_file):
                    continue

                try:
                    with open(sessions_file, "r", encoding="utf-8") as f:
                        sessions_data = json.load(f)
                except Exception:
                    continue

                if not isinstance(sessions_data, dict):
                    continue

                for session_key, meta in sessions_data.items():
                    if not isinstance(meta, dict):
                        continue
                    meta_json = json.dumps(meta, ensure_ascii=False)
                    current = conn.execute(
                        "SELECT meta_json FROM session_meta WHERE session_key=?",
                        (session_key,),
                    ).fetchone()
                    if current and current["meta_json"] == meta_json:
                        continue
                    conn.execute(
                        """INSERT OR REPLACE INTO session_meta(
                               session_key, agent_id, session_id, model, provider,
                               input_tokens, output_tokens, total_tokens, context_tokens,
                               updated_at, meta_json
                           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            session_key,
                            agent_name,
                            meta.get("sessionId", ""),
                            meta.get("model", ""),
                            meta.get("modelProvider", ""),
                            int(meta.get("inputTokens", 0)),
                            int(meta.get("outputTokens", 0)),
                            int(meta.get("totalTokens", 0)),
                            int(meta.get("contextTokens", 0)),
                            int(meta.get("updatedAt", 0)),
                            meta_json,
                        ),
                    )
                    count += 1

            conn.commit()
        return count
