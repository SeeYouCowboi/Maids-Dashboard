#!/usr/bin/env python3
"""Maids Dashboard — thin uvicorn entry point.

All route handlers live in api/.
All business logic lives in services/.
All shared models live in core/.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
import threading
from pathlib import Path
from typing import Any

import uvicorn

# NOTE: api.app imported lazily in run_server() to avoid circular imports
from core.utils import load_config, get_openclaw_root
from dashboard_db import DashboardDB
from ingestion import IngestionEngine
from sse_manager import SSEManager
import services.state as state

logger = logging.getLogger(__name__)

DEFAULT_DASHBOARD_CONFIG: dict[str, Any] = {
    "dashboardBindHost": "127.0.0.1",
    "dashboardPort": 18889,
}
DEFAULT_CONFIG_PATH = os.path.expanduser("~/.openclaw/workspace/maids/config.json")
DEFAULT_DASHBOARD_DB_PATH = "workspace/maids/state/dashboard.db"


def load_dashboard_config(config_path: str = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    """Load dashboard config from JSON file."""
    try:
        import json

        with open(config_path) as f:
            return json.load(f)
    except Exception:
        return {}


def resolve_dashboard_db_path(config: dict[str, Any]) -> str:
    """Resolve the dashboard database path from config or default."""
    configured = config.get("dashboardDbPath") or config.get("dashboard_db_path")
    raw_path = str(configured) if configured else DEFAULT_DASHBOARD_DB_PATH
    expanded = os.path.expanduser(raw_path)
    if os.path.isabs(expanded):
        return expanded
    openclaw_root = Path(os.path.expanduser("~/.openclaw"))
    return str((openclaw_root / expanded).resolve())


def run_server(
    host: str = "127.0.0.1", port: int = 18889, config: dict[str, Any] | None = None
) -> None:
    """Initialize shared state and start uvicorn."""
    cfg = dict(config or {})

    # Initialize database
    db = DashboardDB(resolve_dashboard_db_path(cfg))
    db.init_db()

    # Initialize SSE manager
    sse_mgr = SSEManager()
    sse_mgr.start()

    # Initialize ingestion engine
    openclaw_root = os.path.expanduser("~/.openclaw")
    engine = IngestionEngine(db, openclaw_root, sse_manager=sse_mgr)
    engine.start()

    # Wire shared state for API routers
    state.init(db, sse_mgr)

    # Create FastAPI app
    from api.app import create_app

    app = create_app()

    # ── Build uvicorn server ───────────────────────────────────────────────
    # We install our own signal handlers below so that we can drain SSE
    # connections *before* uvicorn waits for them — without this, the first
    # Ctrl-C deadlocks (uvicorn waits for SSE generators that only
    # sse_mgr.stop() would unblock, which used to live in `finally`).
    uvi_cfg = uvicorn.Config(app, host=host, port=port, workers=1, log_level="info")
    server = uvicorn.Server(uvi_cfg)
    # Prevent uvicorn from overriding our handlers when serve() starts.
    server.install_signal_handlers = lambda: None  # type: ignore[method-assign]

    # ── Two-phase shutdown ────────────────────────────────────────────────
    # Phase 1 (first Ctrl-C): close SSE connections so generators unblock,
    #   then ask uvicorn to exit gracefully.
    # Phase 2 (second Ctrl-C): hard-exit immediately via os._exit().
    _sigint_count = 0
    _shutdown_requested = threading.Event()

    def _handle_signal(signum: int, frame: object) -> None:
        nonlocal _sigint_count
        _sigint_count += 1
        if _sigint_count == 1:
            _shutdown_requested.set()
            sys.stderr.write(
                "\n[Dashboard] Interrupt received — draining connections…"
                "\n[Dashboard] Press Ctrl-C again to force quit.\n"
            )
            sys.stderr.flush()
            # Run sse_mgr.stop() in a daemon thread so the signal handler
            # returns immediately (stop() may join a thread for ~3 s).
            # Once SSE queues receive their poison pill the generators finish
            # and uvicorn can complete its graceful shutdown.
            threading.Thread(
                target=sse_mgr.stop, daemon=True, name="sse-shutdown"
            ).start()
            server.should_exit = True
        else:
            sys.stderr.write("\n[Dashboard] Force quit.\n")
            sys.stderr.flush()
            os._exit(1)

    signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_signal)

    logger.info("Dashboard backend starting on http://%s:%s", host, port)
    try:
        asyncio.run(server.serve())
    except KeyboardInterrupt:
        # On some platforms (notably Windows + asyncio), the second Ctrl-C
        # may surface as a KeyboardInterrupt caught by asyncio.run() rather
        # than routing through our signal handler.  If graceful shutdown was
        # already requested, treat this as a force-quit.
        if _shutdown_requested.is_set():
            sys.stderr.write("\n[Dashboard] Force quit.\n")
            sys.stderr.flush()
            os._exit(1)
        # Otherwise (rare: first interrupt surfaced here) — fall through to
        # finally for normal cleanup.
    finally:
        # Guard against double-stop if the signal handler already ran.
        if not sse_mgr._shutdown_event.is_set():
            sse_mgr.stop()
        engine.stop()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
    )
    config = load_dashboard_config()
    host = os.environ.get("DASHBOARD_BIND_HOST") or str(
        config.get("dashboardBindHost", DEFAULT_DASHBOARD_CONFIG["dashboardBindHost"])
    )
    port = int(
        os.environ.get("DASHBOARD_PORT")
        or config.get("dashboardPort", DEFAULT_DASHBOARD_CONFIG["dashboardPort"])
    )
    run_server(host=host, port=port, config=config)
