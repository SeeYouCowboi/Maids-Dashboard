from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from services.cron_service import load_cron_jobs, summarize_last_runs

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
        raise HTTPException(status_code=500, detail={"error": f"failed to read cron/jobs.json: {exc}"})

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
