from __future__ import annotations



from dashboard_db import DashboardDB
from sse_manager import SSEManager

_dashboard_db: DashboardDB | None = None
_sse_manager: SSEManager | None = None


def get_db() -> DashboardDB | None:
    return _dashboard_db


def get_sse() -> SSEManager | None:
    return _sse_manager


def init(db: DashboardDB, sse: SSEManager) -> None:
    global _dashboard_db, _sse_manager
    _dashboard_db = db
    _sse_manager = sse
