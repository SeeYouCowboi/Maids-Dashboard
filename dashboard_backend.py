#!/usr/bin/env python3
"""Maids Dashboard — thin uvicorn entry point.

All route handlers live in api/.
All business logic lives in services/.
All shared models live in core/.
"""

from __future__ import annotations

import logging
import os
import sys
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


def run_server(host: str = "127.0.0.1", port: int = 18889, config: dict[str, Any] | None = None) -> None:
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

    # Create and start FastAPI app
    from api.app import create_app
    app = create_app()
    logger.info("Dashboard backend starting on http://%s:%s", host, port)
    try:
        uvicorn.run(app, host=host, port=port, workers=1, log_level="info")
    finally:
        sse_mgr.stop()
        engine.stop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    config = load_dashboard_config()
    host = os.environ.get("DASHBOARD_BIND_HOST") or str(config.get("dashboardBindHost", DEFAULT_DASHBOARD_CONFIG["dashboardBindHost"]))
    port = int(os.environ.get("DASHBOARD_PORT") or config.get("dashboardPort", DEFAULT_DASHBOARD_CONFIG["dashboardPort"]))
    run_server(host=host, port=port, config=config)
