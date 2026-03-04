from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException

from services.cron_service import load_cron_jobs, summarize_last_runs, cron_jobs_path
from services.shared import write_bytes_atomic

router = APIRouter(prefix="/api/v1", tags=["cron"])


def _redact_last_error_fields(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_str = str(key)
            normalized = key_str.replace("_", "").lower()
            if normalized == "lasterror":
                redacted[key_str] = "[REDACTED]"
            else:
                redacted[key_str] = _redact_last_error_fields(item)
        return redacted
    if isinstance(value, list):
        return [_redact_last_error_fields(item) for item in value]
    return value


@router.get("/cron/jobs")
def get_cron_jobs() -> dict[str, Any]:
    try:
        jobs_payload, _ = load_cron_jobs()
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail={"error": f"failed to read cron/jobs.json: {exc}"}
        )

    jobs_raw = jobs_payload.get("jobs", []) if isinstance(jobs_payload, dict) else []
    jobs: list[dict[str, Any]] = []
    job_ids: list[str] = []
    for item in jobs_raw:
        if not isinstance(item, dict):
            continue
        job_id = str(item.get("id", "")).strip()
        if not job_id:
            continue
        job_ids.append(job_id)
        jobs.append(_redact_last_error_fields(item))

    return {
        "jobs": jobs,
        "last_run_summary": summarize_last_runs(job_ids),
    }


@router.post("/cron/jobs/{job_id}/toggle")
def toggle_cron_job(job_id: str) -> dict[str, Any]:
    try:
        jobs_payload, before_raw = load_cron_jobs()
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail={"error": f"failed to read cron/jobs.json: {exc}"}
        )

    jobs_raw = jobs_payload.get("jobs", []) if isinstance(jobs_payload, dict) else []
    found = False
    for item in jobs_raw:
        if not isinstance(item, dict):
            continue
        if str(item.get("id", "")).strip() == job_id:
            item["enabled"] = not bool(item.get("enabled", True))
            found = True
            break

    if not found:
        raise HTTPException(
            status_code=404, detail={"error": f"job '{job_id}' not found"}
        )

    after_raw = (
        json.dumps(jobs_payload, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    )
    try:
        write_bytes_atomic(cron_jobs_path(), after_raw)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail={"error": f"failed to write cron/jobs.json: {exc}"}
        )

    return {"ok": True, "job_id": job_id}
