from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from api import (
    canon,
    config,
    cron,
    delivery,
    dispatch,
    gateway,
    heartbeat,
    incidents,
    maids,
    plot,
    rp,
    sessions,
)


ALLOWED_ORIGINS = frozenset(
    {
        "http://127.0.0.1:18889",
        "http://localhost:18889",
    }
)

SKIP_CHECK_PATHS = (
    "/api/v1/health",
    "/api/v1/stream",
)

WRITE_METHODS = frozenset({"POST", "PUT", "DELETE"})


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip checks for GET requests
        if request.method == "GET":
            return await call_next(request)

        # Skip checks for certain paths
        if path.startswith(SKIP_CHECK_PATHS):
            return await call_next(request)

        # Origin check - reject if origin is present and not in allowed list
        origin = request.headers.get("Origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            return JSONResponse({"error": "Forbidden: invalid origin"}, status_code=403)

        # Confirm secret check for write operations to /api/v1/
        if request.method in WRITE_METHODS and path.startswith("/api/v1/"):
            expected_secret = os.environ.get("DASHBOARD_CONFIRM_SECRET", "")
            if expected_secret:
                actual_secret = request.headers.get("X-Confirm-Secret", "")
                if actual_secret != expected_secret:
                    return JSONResponse(
                        {"error": "Forbidden: missing or invalid X-Confirm-Secret"},
                        status_code=403,
                    )

        return await call_next(request)


def create_app() -> FastAPI:
    app = FastAPI(title="Maids Dashboard", version="1.0.0")
    app.add_middleware(SecurityMiddleware)
    app.include_router(heartbeat.router)
    app.include_router(maids.router)
    app.include_router(sessions.router)
    app.include_router(config.router)
    app.include_router(canon.router)
    app.include_router(incidents.router)
    app.include_router(cron.router)
    app.include_router(delivery.router)
    app.include_router(dispatch.router)
    app.include_router(gateway.router)
    app.include_router(plot.router)
    app.include_router(rp.router)
    _static_dir = Path(__file__).parent.parent / "static"
    _static_dir.mkdir(
        parents=True, exist_ok=True
    )  # create if absent (e.g. CI without frontend build)
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")

    return app
