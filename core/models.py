"""Shared data models for MAIDS Dashboard.

Pydantic BaseModels for API boundaries (request/response).
TypedDicts for internal data flow (SQLite rows, service layer).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict
from typing_extensions import TypedDict


# ---------------------------------------------------------------------------
# Patch — the MAID_COMMIT patch object (stored as patch_json in world_revision)
# Fields from canon_validator.py validate_patch_schema
# ---------------------------------------------------------------------------

class PatchModel(BaseModel):
    """Pydantic model for API-facing patch data."""

    model_config = ConfigDict(from_attributes=True)

    entities_add: list[dict[str, Any]] | None = None
    facts_add: list[dict[str, Any]] | None = None
    facts_retire: list[dict[str, Any]] | None = None
    plot_move: dict[str, Any] | None = None
    notes: str | None = None


class PatchDict(TypedDict, total=False):
    """TypedDict for internal patch data flow."""

    entities_add: list[dict[str, Any]]
    facts_add: list[dict[str, Any]]
    facts_retire: list[dict[str, Any]]
    plot_move: dict[str, Any]
    notes: str


# ---------------------------------------------------------------------------
# Snapshot — full world state (stored as snapshot_json in world_revision)
# Shape from canon_store._empty_snapshot / _normalize_snapshot
# ---------------------------------------------------------------------------

class SnapshotModel(BaseModel):
    """Pydantic model for API-facing snapshot data."""

    model_config = ConfigDict(from_attributes=True)

    world_id: str
    rev_id: str | None = None
    parent_rev_id: str | None = None
    created_at: str | None = None
    invariants: dict[str, Any] = {}
    entities: list[dict[str, Any]] = []
    facts: list[dict[str, Any]] = []
    plot: dict[str, Any] = {}
    recent_events: list[Any] = []


class SnapshotDict(TypedDict, total=False):
    """TypedDict for internal snapshot data flow."""

    world_id: str
    rev_id: str | None
    parent_rev_id: str | None
    created_at: str | None
    invariants: dict[str, Any]
    entities: list[dict[str, Any]]
    facts: list[dict[str, Any]]
    plot: dict[str, Any]
    recent_events: list[Any]


# ---------------------------------------------------------------------------
# Entity — SQLite entity row
# Columns from: CREATE TABLE entity (entity_id, world_id, type, name,
#   canonical_description, created_at_ms, updated_at_ms)
# ---------------------------------------------------------------------------

class EntityModel(BaseModel):
    """Pydantic model for API-facing entity data."""

    model_config = ConfigDict(from_attributes=True)

    entity_id: str
    world_id: str
    type: str
    name: str
    canonical_description: str | None = None
    created_at_ms: int
    updated_at_ms: int


class EntityDict(TypedDict):
    """TypedDict matching SQLite entity row shape."""

    entity_id: str
    world_id: str
    type: str
    name: str
    canonical_description: str | None
    created_at_ms: int
    updated_at_ms: int


# ---------------------------------------------------------------------------
# Fact — SQLite fact row
# Columns from: CREATE TABLE fact (fact_id, world_id, subject_name,
#   predicate, object_value, status, confidence, canonicity,
#   valid_from_rev_id, valid_until_rev_id, retcon_reason, retcon_rev_id,
#   confirmed_by_rev_id, created_at_ms, updated_at_ms)
# ---------------------------------------------------------------------------

class FactModel(BaseModel):
    """Pydantic model for API-facing fact data."""

    model_config = ConfigDict(from_attributes=True)

    fact_id: str
    world_id: str
    subject_name: str
    predicate: str
    object_value: str
    status: str
    confidence: float
    canonicity: str = "canon"
    valid_from_rev_id: str
    valid_until_rev_id: str | None = None
    retcon_reason: str | None = None
    retcon_rev_id: str | None = None
    confirmed_by_rev_id: str | None = None
    created_at_ms: int
    updated_at_ms: int


class FactDict(TypedDict):
    """TypedDict matching SQLite fact row shape."""

    fact_id: str
    world_id: str
    subject_name: str
    predicate: str
    object_value: str
    status: str
    confidence: float
    canonicity: str
    valid_from_rev_id: str
    valid_until_rev_id: str | None
    retcon_reason: str | None
    retcon_rev_id: str | None
    confirmed_by_rev_id: str | None
    created_at_ms: int
    updated_at_ms: int
