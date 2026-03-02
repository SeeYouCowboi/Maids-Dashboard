#!/usr/bin/env python3
"""SQLite manager for dashboard-owned derived data."""

from __future__ import annotations

import logging
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

logger = logging.getLogger(__name__)

class DashboardDB:
    """Thread-safe dashboard SQLite wrapper using per-thread connections."""

    def __init__(self, db_path: str) -> None:
        self.db_path = Path(db_path)
        self._thread_local = threading.local()
        self._init_lock = threading.Lock()
        self._initialized = False

    def _create_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _thread_connection(self) -> sqlite3.Connection:
        conn = getattr(self._thread_local, "connection", None)
        if conn is None:
            conn = self._create_connection()
            self._thread_local.connection = conn
        return conn

    def init_db(self) -> None:
        with self._init_lock:
            if self._initialized:
                return
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = self._thread_connection()
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS ingest_offset(
                    source TEXT PRIMARY KEY,
                    value INTEGER
                );

                CREATE TABLE IF NOT EXISTS event_index(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts_ms INTEGER,
                    kind TEXT,
                    payload_json TEXT
                );

                CREATE TABLE IF NOT EXISTS config_audit(
                    id TEXT PRIMARY KEY,
                    ts_ms INTEGER,
                    kind TEXT,
                    path TEXT,
                    before_sha256 TEXT,
                    after_sha256 TEXT,
                    summary TEXT
                );

                CREATE TABLE IF NOT EXISTS rp_room(
                    id TEXT PRIMARY KEY,
                    created_at INTEGER,
                    world_id TEXT,
                    play_id TEXT,
                    branch_id TEXT,
                    status TEXT
                );

                CREATE TABLE IF NOT EXISTS rp_room_participant(
                    room_id TEXT,
                    character_id TEXT,
                    joined_at INTEGER,
                    PRIMARY KEY(room_id, character_id)
                );

                CREATE TABLE IF NOT EXISTS rp_room_message(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    room_id TEXT,
                    character_id TEXT,
                    content TEXT,
                    created_at INTEGER,
                    kind TEXT
                );
                """
            )
            conn.commit()
            self._initialized = True

    @contextmanager
    def get_connection(self) -> Iterator[sqlite3.Connection]:
        self.init_db()
        conn = self._thread_connection()
        try:
            yield conn
        finally:
            pass

    def health_check(self) -> dict[str, object]:
        try:
            with self.get_connection() as conn:
                conn.execute("SELECT 1")
            return {"ok": True, "path": str(self.db_path)}
        except Exception as exc:
            return {"ok": False, "path": str(self.db_path), "error": str(exc)}
