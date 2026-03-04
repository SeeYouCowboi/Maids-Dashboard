"""Canonical shared utilities for the maids-dashboard package."""

from __future__ import annotations

import logging
import json
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_REL_PATH = os.path.join("workspace", "maids", "config.json")


def get_openclaw_root() -> str:
    """Get the OpenClaw root directory.

    Checks OPENCLAW_ROOT env var first, then falls back to inferring
    from this file's location (4 levels up from core/utils.py), and
    ultimately to ~/.openclaw if the inferred path does not look valid.
    """
    if "OPENCLAW_ROOT" in os.environ:
        return os.environ["OPENCLAW_ROOT"]

    # core/utils.py is at workspace/tools/maids-dashboard/core/utils.py
    # So root is 4 levels up (core -> maids-dashboard -> tools -> workspace -> root)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    package_dir = os.path.dirname(script_dir)  # maids-dashboard
    inferred = os.path.dirname(os.path.dirname(os.path.dirname(package_dir)))

    # Sanity check: the inferred root should contain an openclaw.json or agents/ dir
    if os.path.isfile(os.path.join(inferred, "openclaw.json")) or os.path.isdir(os.path.join(inferred, "agents")):
        return inferred

    # Fallback to ~/.openclaw (the conventional default)
    fallback = os.path.expanduser("~/.openclaw")
    logger.warning(
        "Could not infer OPENCLAW_ROOT from project layout (inferred=%s). "
        "Falling back to %s. Set OPENCLAW_ROOT env var to suppress this warning.",
        inferred, fallback,
    )
    return fallback


def now_ms() -> int:
    """Return current time in milliseconds since epoch."""
    return time.time_ns() // 1_000_000


def load_config(openclaw_root: str) -> dict[str, Any]:
    """Load workspace/maids/config.json from the OpenClaw root.

    Returns the parsed config dict, or empty dict on error.
    """
    config_path = os.path.join(openclaw_root, DEFAULT_CONFIG_REL_PATH)
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
