#!/usr/bin/env python3
"""Append-only JSONL event log with cross-process locking."""

from __future__ import annotations

import logging
import json
import os
import time
import threading
import uuid
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

from core.utils import get_openclaw_root, load_config, now_ms

DEFAULT_CONFIG_REL_PATH = os.path.join("workspace", "maids", "config.json")
DEFAULT_EVENT_LOG_REL_PATH = os.path.join("workspace", "maids", "state", "events.jsonl")

_EVENTS_LOCK = threading.Lock()


def resolve_event_log_path(*, openclaw_root: str | None = None, config: dict[str, Any] | None = None) -> str:
    root = openclaw_root or get_openclaw_root()
    cfg = config if config is not None else load_config(root)
    rel = cfg.get("eventLogPath") or DEFAULT_EVENT_LOG_REL_PATH
    return os.path.join(root, rel)


def new_trace_id() -> str:
    return uuid.uuid4().hex


@dataclass(frozen=True)
class Event:
    ts_ms: int
    kind: str
    trace_id: str
    run_id: str | None
    agent_id: str | None
    session_id: str | None
    payload: dict[str, Any]
    orchestrated: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "ts_ms": self.ts_ms,
            "kind": self.kind,
            "trace_id": self.trace_id,
            "run_id": self.run_id,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "payload": self.payload,
            "orchestrated": bool(self.orchestrated),
        }


def _acquire_lock(
    lock_path: str,
    *,
    stale_after_s: float = 120.0,
    max_wait_s: float = 30.0,
) -> None:
    start = time.time()
    delay = 0.002

    while True:
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            return None
        except (FileExistsError, PermissionError):
            pass

        try:
            age_s = time.time() - os.path.getmtime(lock_path)
        except FileNotFoundError:
            continue
        except PermissionError:
            age_s = 0.0

        if age_s > stale_after_s:
            try:
                os.unlink(lock_path)
            except FileNotFoundError:
                pass
            except PermissionError:
                pass
            continue

        if time.time() - start > max_wait_s:
            raise TimeoutError(f"Timed out acquiring event log lock: {lock_path}")

        time.sleep(delay)
        delay = min(delay * 1.5, 0.05)


def _release_lock(lock_path: str) -> None:
    try:
        os.unlink(lock_path)
    except FileNotFoundError:
        pass


def append_event(
    kind: str,
    *,
    orchestrated: bool = False,
    trace_id: str | None = None,
    run_id: str | None = None,
    agent_id: str | None = None,
    session_id: str | None = None,
    payload: dict[str, Any] | None = None,
    ts_ms: int | None = None,
    event_log_path: str | None = None,
    openclaw_root: str | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if payload is None:
        payload = {}
    if ts_ms is None:
        ts_ms = now_ms()
    if trace_id is None:
        trace_id = new_trace_id()

    if event_log_path is None:
        event_log_path = resolve_event_log_path(openclaw_root=openclaw_root, config=config)

    event = Event(
        ts_ms=int(ts_ms),
        kind=str(kind),
        trace_id=str(trace_id),
        run_id=run_id,
        agent_id=agent_id,
        session_id=session_id,
        payload=dict(payload),
        orchestrated=bool(orchestrated),
    ).to_dict()

    with _EVENTS_LOCK:
        os.makedirs(os.path.dirname(event_log_path), exist_ok=True)
        lock_path = event_log_path + ".lock"
        acquired = False

        try:
            _acquire_lock(lock_path)
            acquired = True

            line = json.dumps(event, ensure_ascii=True, separators=(",", ":")) + "\n"
            with open(event_log_path, "a", encoding="utf-8", newline="\n") as f:
                f.write(line)
                f.flush()
        finally:
            if acquired:
                _release_lock(lock_path)

    return event
