#!/usr/bin/env python3
"""SSE (Server-Sent Events) connection manager for the dashboard backend.

Manages client connections, heartbeats, idle timeouts, and event broadcasting.
No external dependencies — stdlib only.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────
MAX_SSE_CLIENTS = int(os.environ.get("MAIDS_DASHBOARD_MAX_SSE_CLIENTS", "10"))
HEARTBEAT_INTERVAL = 15  # seconds
IDLE_TIMEOUT = 300  # 5 minutes — close if only heartbeats sent


class SSEClient:
    """Represents a single SSE connection."""

    __slots__ = ("wfile", "event_queue", "last_data_event", "connected", "_lock")

    def __init__(self, wfile: Any = None) -> None:
        self.wfile = wfile
        self.event_queue: queue.Queue[str | None] = queue.Queue()
        self.last_data_event: float = time.monotonic()
        self.connected: bool = True
        self._lock = threading.Lock()

    def send_raw(self, message: str) -> bool:
        """Write a raw SSE message to the wire. Returns False on failure."""
        if self.wfile is None:
            return True
        try:
            self.wfile.write(message.encode("utf-8"))
            self.wfile.flush()
            return True
        except Exception:
            self.connected = False
            return False

    def close(self) -> None:
        with self._lock:
            self.connected = False
        # Poison pill to unblock queue.get()
        self.event_queue.put(None)


class SSEManager:
    """Thread-safe manager for SSE client connections.

    Responsibilities:
    - Track active clients up to MAX_SSE_CLIENTS
    - Broadcast events to all connected clients
    - Send heartbeat pings every ~15 seconds
    - Close idle connections (5 minutes with no real data events)
    - Graceful shutdown: send ``event: shutdown`` then close all
    """

    def __init__(self) -> None:
        self._clients: set[SSEClient] = set()
        self._lock = threading.Lock()
        self._shutdown_event = threading.Event()
        self._heartbeat_thread: threading.Thread | None = None

    # ── lifecycle ─────────────────────────────────────────────

    def start(self) -> None:
        """Start the heartbeat / idle-reaper background thread."""
        if self._heartbeat_thread is not None and self._heartbeat_thread.is_alive():
            return
        self._shutdown_event.clear()
        self._heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop, daemon=True, name="sse-heartbeat"
        )
        self._heartbeat_thread.start()
        logger.info("SSE manager started (max_clients=%d)", MAX_SSE_CLIENTS)

    def stop(self) -> None:
        """Graceful shutdown: broadcast shutdown event, close all clients."""
        self._shutdown_event.set()
        # Send shutdown event to every client
        shutdown_msg = "event: shutdown\ndata: \n\n"
        with self._lock:
            for client in list(self._clients):
                client.event_queue.put(shutdown_msg)
        # Give clients a moment to flush the shutdown message
        if self._heartbeat_thread is not None:
            self._heartbeat_thread.join(timeout=3.0)
        # Force-close any remaining
        with self._lock:
            for client in list(self._clients):
                client.close()
            self._clients.clear()
        logger.info("SSE manager stopped")

    # ── client management ─────────────────────────────────────

    def register(self, client: SSEClient) -> bool:
        """Add a client. Returns False (cap reached) without registering."""
        with self._lock:
            if len(self._clients) >= MAX_SSE_CLIENTS:
                return False
            self._clients.add(client)
            logger.debug("SSE client registered (%d active)", len(self._clients))
            return True

    def unregister(self, client: SSEClient) -> None:
        """Remove a client from tracking."""
        with self._lock:
            self._clients.discard(client)
            logger.debug("SSE client unregistered (%d active)", len(self._clients))

    @property
    def client_count(self) -> int:
        with self._lock:
            return len(self._clients)

    # ── broadcasting ──────────────────────────────────────────

    def broadcast(self, event_type: str, data: Any = None) -> None:
        """Push an event into every client's queue (non-blocking)."""
        if data is None:
            payload = ""
        elif isinstance(data, str):
            payload = data
        else:
            payload = json.dumps(data, ensure_ascii=False)

        message = f"event: {event_type}\ndata: {payload}\n\n"
        with self._lock:
            dead: list[SSEClient] = []
            for client in self._clients:
                if not client.connected:
                    dead.append(client)
                    continue
                client.event_queue.put(message)
                client.last_data_event = time.monotonic()
            for client in dead:
                self._clients.discard(client)

    # ── heartbeat / idle reaper ───────────────────────────────

    def _heartbeat_loop(self) -> None:
        heartbeat_msg = "event: heartbeat\ndata: \n\n"
        while not self._shutdown_event.is_set():
            self._shutdown_event.wait(HEARTBEAT_INTERVAL)
            if self._shutdown_event.is_set():
                break
            now = time.monotonic()
            with self._lock:
                dead: list[SSEClient] = []
                for client in self._clients:
                    if not client.connected:
                        dead.append(client)
                        continue
                    # Idle timeout: no real data events for IDLE_TIMEOUT seconds
                    if now - client.last_data_event > IDLE_TIMEOUT:
                        logger.debug("SSE client idle-timed out")
                        dead.append(client)
                        continue
                    # Queue heartbeat (does NOT update last_data_event)
                    client.event_queue.put(heartbeat_msg)
                for client in dead:
                    client.close()
                    self._clients.discard(client)
