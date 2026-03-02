from __future__ import annotations

import os
import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException


def _canon_row_dicts(query: str, params: tuple = ()) -> list[dict]:
    """Execute a query against canon.db and return results as dicts."""
    openclaw_root = os.path.expanduser("~/.openclaw")
    db_path = os.path.join(openclaw_root, "workspace/maids/state/canon.db")
    try:
        conn = sqlite3.connect(db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, params).fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception:
        return []


def _canon_world_exists(world_id: str) -> bool:
    rows = _canon_row_dicts("SELECT world_id FROM world WHERE world_id=?", (world_id,))
    return len(rows) > 0
from services.shared import _iso_from_ms

router = APIRouter(prefix="/api/v1", tags=["canon"])


@router.get("/worlds")
def list_worlds() -> dict[str, Any]:
    rows = _canon_row_dicts("SELECT world_id, name, created_at_ms FROM world ORDER BY created_at_ms ASC, world_id ASC")
    worlds = [
        {
            "id": row["world_id"],
            "name": row.get("name") or row["world_id"],
            "created_at": _iso_from_ms(row.get("created_at_ms")),
        }
        for row in rows
    ]
    return {"worlds": worlds}


@router.get("/worlds/{world_id}/branches")
def list_world_branches(world_id: str) -> dict[str, Any]:
    if not _canon_world_exists(world_id):
        raise HTTPException(status_code=404, detail={"error": "World not found"})
    rows = _canon_row_dicts(
        "SELECT branch_id, world_id, name, head_rev_id FROM branch WHERE world_id=? ORDER BY created_at_ms ASC, branch_id ASC",
        (world_id,),
    )
    branches = [
        {
            "id": row["branch_id"],
            "world_id": row["world_id"],
            "name": row.get("name") or row["branch_id"],
            "head": row.get("head_rev_id"),
        }
        for row in rows
    ]
    return {"branches": branches}


@router.get("/worlds/{world_id}/branches/{branch_id}/head")
def get_branch_head(world_id: str, branch_id: str) -> dict[str, Any]:
    rows = _canon_row_dicts(
        "SELECT head_rev_id FROM branch WHERE world_id=? AND branch_id=? LIMIT 1",
        (world_id, branch_id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail={"error": "Branch not found"})

    head_id = rows[0].get("head_rev_id")
    commit = None
    if head_id:
        rev_rows = _canon_row_dicts(
            "SELECT rev_id, summary, created_at_ms FROM world_revision WHERE world_id=? AND branch_id=? AND rev_id=? LIMIT 1",
            (world_id, branch_id, head_id),
        )
        if rev_rows:
            rev = rev_rows[0]
            commit = {
                "id": rev["rev_id"],
                "branch_id": branch_id,
                "message": rev.get("summary") or "",
                "timestamp": _iso_from_ms(rev.get("created_at_ms")),
            }

    return {"head": commit}


@router.get("/worlds/{world_id}/entities")
def list_world_entities(world_id: str) -> dict[str, Any]:
    if not _canon_world_exists(world_id):
        raise HTTPException(status_code=404, detail={"error": "World not found"})
    rows = _canon_row_dicts(
        "SELECT entity_id, type, name FROM entity WHERE world_id=? ORDER BY type ASC, name ASC, entity_id ASC",
        (world_id,),
    )
    entities = [
        {
            "id": row["entity_id"],
            "type": row["type"],
            "name": row["name"],
        }
        for row in rows
    ]
    return {"entities": entities}


@router.get("/worlds/{world_id}/facts")
def list_world_facts(world_id: str) -> dict[str, Any]:
    if not _canon_world_exists(world_id):
        raise HTTPException(status_code=404, detail={"error": "World not found"})
    rows = _canon_row_dicts(
        "SELECT fact_id, subject_name, predicate, object_value FROM fact WHERE world_id=? ORDER BY created_at_ms ASC, fact_id ASC",
        (world_id,),
    )
    facts = [
        {
            "id": row["fact_id"],
            "entity_id": row["subject_name"],
            "predicate": row["predicate"],
            "value": row["object_value"],
        }
        for row in rows
    ]
    return {"facts": facts}
