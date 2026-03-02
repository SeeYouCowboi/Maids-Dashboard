#!/usr/bin/env python3

from __future__ import annotations

import logging
import glob
import hashlib
import json
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass

import sys
from typing import Any
import event_log  # pyright: ignore[reportImplicitRelativeImport]
from core.utils import get_openclaw_root, load_config, now_ms


logger = logging.getLogger(__name__)



DEFAULT_SESSIONS_INDEX_REL_PATH = os.path.join("agents", "sessions.json")
DEFAULT_CONFIG_REL_PATH = os.path.join("workspace", "maids", "config.json")
DEFAULT_CANON_DB_REL_PATH = os.path.join("workspace", "maids", "state", "canon.db")



def _resolve_canon_db_path(openclaw_root: str, config: dict[str, Any | None]) -> str:
    cfg = config if config is not None else load_config(openclaw_root)
    rel = cfg.get("canonDbPath") or DEFAULT_CANON_DB_REL_PATH
    return os.path.join(openclaw_root, rel)


def _is_deleted_jsonl(path: str) -> bool:
    base = os.path.basename(path)
    return ".jsonl.deleted." in base


def _sessions_index_is_stale(index_path: str, *, now_ms_value: int | None = None) -> bool:
    if not os.path.exists(index_path):
        return True
    if now_ms_value is None:
        now_ms_value = now_ms()
    try:
        age_s = (now_ms_value / 1000.0) - os.path.getmtime(index_path)
    except OSError:
        return True
    return age_s > 300.0


def _parse_sessions_index(index_path: str) -> list[str | None]:
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None

    if isinstance(data, list) and all(isinstance(x, str) for x in data):
        return list(data)

    if isinstance(data, dict):
        for key in ("sessions", "files", "paths"):
            val = data.get(key)
            if isinstance(val, list) and all(isinstance(x, str) for x in val):
                return list(val)

    return None


def discover_session_files(openclaw_root: str, *, now_ms_value: int | None = None) -> list[str]:
    index_path = os.path.join(openclaw_root, DEFAULT_SESSIONS_INDEX_REL_PATH)
    use_index = (not _sessions_index_is_stale(index_path, now_ms_value=now_ms_value))

    files: list[str] = []
    if use_index:
        rel_paths = _parse_sessions_index(index_path)
        if rel_paths is not None:
            for rel in rel_paths:
                p = os.path.join(openclaw_root, rel)
                if p.endswith(".jsonl") and (not _is_deleted_jsonl(p)) and os.path.exists(p):
                    files.append(p)
        else:
            use_index = False

    if not use_index:
        pattern = os.path.join(openclaw_root, "agents", "*", "sessions", "*.jsonl")
        for p in glob.glob(pattern):
            if _is_deleted_jsonl(p):
                continue
            files.append(p)

    files = sorted(set(files))
    return files


def _relpath_safe(path: str, base: str) -> str:
    try:
        return os.path.relpath(path, base)
    except ValueError:
        return path


def _trace_id_for_session_message(session_id: str, message_offset: int) -> str:
    h = hashlib.blake2b(f"{session_id}:{message_offset}".encode("utf-8"), digest_size=16).digest()
    return uuid.UUID(bytes=h).hex


def _extract_speaker(msg: dict[str, Any]) -> str:
    for key in ("speaker", "role", "author", "name"):
        v = msg.get(key)
        if isinstance(v, str) and v.strip():
            return v
    return "unknown"


def _extract_ts_ms(msg: dict[str, Any], *, fallback_ms: int) -> int:
    for key in ("updated_at_ms", "ts_ms", "timestamp_ms"):
        v = msg.get(key)
        if isinstance(v, int):
            return v
        if isinstance(v, float):
            return int(v)
    return int(fallback_ms)


def _sanitize_payload(msg: dict[str, Any]) -> dict[str, Any]:
    text = None
    for key in ("content", "text", "message"):
        v = msg.get(key)
        if isinstance(v, str):
            text = v
            break
    return {
        "has_text": bool(text),
        "text_len": (len(text) if text is not None else 0),
        "model": (msg.get("model") if isinstance(msg.get("model"), str) else None),
    }


def _table_info(conn: sqlite3.Connection, table: str) -> list[tuple[Any, ...]]:
    cur = conn.execute(f"PRAGMA table_info({table})")
    return list(cur.fetchall())


def _run_table_columns(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    info = _table_info(conn, "run")
    if not info:
        raise RuntimeError("run table not found")

    cols: dict[str, dict[str, Any]] = {}
    for cid, name, col_type, notnull, dflt_value, pk in info:
        cols[str(name)] = {
            "type": str(col_type or ""),
            "notnull": bool(notnull),
            "default": dflt_value,
            "pk": bool(pk),
        }
    return cols


def _default_value_for_column(col_meta: dict[str, Any]) -> Any:
    col_type = (col_meta.get("type") or "").upper()
    if "INT" in col_type:
        return 0
    if any(t in col_type for t in ("CHAR", "CLOB", "TEXT")):
        return ""
    if "BLOB" in col_type:
        return b""
    if any(t in col_type for t in ("REAL", "FLOA", "DOUB")):
        return 0.0
    return ""


@dataclass
class IngestStats:
    files_seen: int = 0
    files_ingested: int = 0
    messages_ingested: int = 0
    errors: int = 0


def ingest_sessions(
    *,
    openclaw_root: str | None = None,
    conn: sqlite3.Connection | None = None,
    canon_db_path: str | None = None,
    event_log_path: str | None = None,
    config: dict[str, Any | None] = None,
    now_ms_value: int | None = None,
) -> IngestStats:
    root = openclaw_root or get_openclaw_root()
    if now_ms_value is None:
        now_ms_value = now_ms()

    close_conn = False
    if conn is None:
        db_path = canon_db_path or _resolve_canon_db_path(root, config)
        conn = sqlite3.connect(db_path)
        close_conn = True

    try:
        stats = IngestStats()
        cols = _run_table_columns(conn)

        session_files = discover_session_files(root, now_ms_value=now_ms_value)
        stats.files_seen = len(session_files)

        for file_path in session_files:
            agent_id = None
            parts = os.path.normpath(file_path).split(os.sep)
            try:
                idx = parts.index("agents")
                agent_id = parts[idx + 1]
            except Exception:
                agent_id = None

            session_id = os.path.splitext(os.path.basename(file_path))[0]
            ingested_any = False

            with open(file_path, "r", encoding="utf-8") as f:
                for offset, raw in enumerate(f):
                    line_number = offset + 1
                    raw = raw.rstrip("\n")
                    if not raw:
                        continue
                    try:
                        msg = json.loads(raw)
                        if not isinstance(msg, dict):
                            raise ValueError("session line is not an object")
                    except Exception as e:
                        stats.errors += 1
                        event_log.append_event(
                            "session.ingest.error",
                            orchestrated=False,
                            payload={
                                "file_path": _relpath_safe(file_path, root),
                                "line_number": line_number,
                                "error": str(e),
                            },
                            event_log_path=event_log_path,
                            openclaw_root=root,
                            config=config,
                        )
                        continue

                    speaker = _extract_speaker(msg)
                    updated_at_ms = _extract_ts_ms(msg, fallback_ms=now_ms_value)
                    trace_id = _trace_id_for_session_message(session_id, offset)
                    safe_payload = _sanitize_payload(msg)

                    row: dict[str, Any] = {
                        "speaker": speaker,
                        "session_id": session_id,
                        "message_offset": int(offset),
                        "updated_at_ms": int(updated_at_ms),
                        "agent_id": agent_id,
                        "kind": "session.message",
                        "trace_id": trace_id,
                        "run_id": None,
                        "orchestrated": 0,
                        "ts_ms": int(updated_at_ms),
                        "payload": json.dumps(safe_payload, ensure_ascii=True, separators=(",", ":")),
                        "payload_json": json.dumps(safe_payload, ensure_ascii=True, separators=(",", ":")),
                    }

                    insert_cols: list[str] = []
                    values: list[Any] = []
                    for name, meta in cols.items():
                        if meta.get("pk") and name not in row:
                            continue
                        if name in row:
                            v = row[name]
                            if meta.get("notnull") and v is None and meta.get("default") is None:
                                v = _default_value_for_column(meta)
                            insert_cols.append(name)
                            values.append(v)
                            continue
                        if meta.get("notnull") and meta.get("default") is None and (not meta.get("pk")):
                            insert_cols.append(name)
                            values.append(_default_value_for_column(meta))

                    if not all(k in insert_cols for k in ("speaker", "session_id", "message_offset", "updated_at_ms")):
                        raise RuntimeError("run table missing required session ingestion columns")

                    placeholders = ",".join(["?"] * len(insert_cols))
                    sql = f"INSERT OR REPLACE INTO run ({','.join(insert_cols)}) VALUES ({placeholders})"
                    conn.execute(sql, values)
                    ingested_any = True
                    stats.messages_ingested += 1

            if ingested_any:
                stats.files_ingested += 1

        conn.commit()
        return stats
    finally:
        if close_conn and conn is not None:
            conn.close()
