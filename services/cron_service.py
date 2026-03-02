from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from core.utils import get_openclaw_root
from services.shared import parse_jsonl_file

def cron_jobs_path() -> Path:
    return Path(get_openclaw_root()) / "cron" / "jobs.json"


def cron_runs_path(job_id: str) -> Path:
    return Path(get_openclaw_root()) / "cron" / "runs" / f"{job_id}.jsonl"


def load_cron_jobs() -> tuple[dict[str, Any], bytes]:
    jobs_path = cron_jobs_path()
    raw = jobs_path.read_bytes()
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("cron jobs payload must be an object")
    jobs = payload.get("jobs")
    if jobs is not None and not isinstance(jobs, list):
        raise ValueError("cron jobs payload must include jobs array")
    return payload, raw


def redact_last_error_fields(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_str = str(key)
            normalized = key_str.replace("_", "").lower()
            if normalized == "lasterror":
                redacted[key_str] = "[REDACTED]"
            else:
                redacted[key_str] = redact_last_error_fields(item)
        return redacted
    if isinstance(value, list):
        return [redact_last_error_fields(item) for item in value]
    return value


def summarize_last_runs(job_ids: list[str]) -> dict[str, dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}
    for job_id in job_ids:
        rows = parse_jsonl_file(cron_runs_path(job_id))
        if not rows:
            continue
        last = rows[-1]
        summaries[job_id] = redact_last_error_fields(
            {
                "ts": last.get("ts"),
                "status": last.get("status"),
                "action": last.get("action"),
                "summary": last.get("summary"),
                "error": last.get("error"),
            }
        )
    return summaries
