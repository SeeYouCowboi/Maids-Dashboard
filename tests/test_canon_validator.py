# pyright: reportMissingImports=false
from __future__ import annotations

import sqlite3
from pathlib import Path
from collections.abc import Iterator
from typing import Protocol, TypedDict, cast

import pytest
import canon.store as canon_store_module
import canon.validator as canon_validator_module



class QualityResult(TypedDict):
    passed: bool
    errors: list[str]
    warnings: list[str]
    score: float


class CanonStoreModule(Protocol):
    def init_db(self, db_path: str) -> None: ...


class CanonValidatorModule(Protocol):
    def run_quality_gate(self, commit: dict[str, object], current_snapshot: dict[str, object], conn: object) -> QualityResult: ...

    def validate_patch_schema(self, patch: dict[str, object]) -> list[str]: ...


canon_store = cast(CanonStoreModule, cast(object, canon_store_module))
canon_validator = cast(CanonValidatorModule, cast(object, canon_validator_module))


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    db_path = tmp_path / "maids.db"
    canon_store.init_db(str(db_path))
    c = sqlite3.connect(str(db_path))
    c.row_factory = sqlite3.Row
    try:
        yield c
    finally:
        c.close()


@pytest.fixture
def snapshot_with_alice() -> dict[str, object]:
    plot_history: list[dict[str, object]] = []
    return {
        "world_id": "w",
        "rev_id": "r",
        "invariants": {"schema_version": 1},
        "entities": [{"type": "character", "name": "Alice"}],
        "facts": [],
        "plot": {"current_node_id": None, "beat_summary": None, "history": plot_history},
    }


def test_rule_1_subject_must_exist_in_entities(conn: sqlite3.Connection, snapshot_with_alice: dict[str, object]):
    commit: dict[str, object] = {
        "patch": {
            "facts_add": [
                {
                    "subject_name": "Bob",
                    "predicate": "exists",
                    "object_value": "true",
                    "status": "asserted",
                    "confidence": 1.0,
                }
            ]
        }
    }
    res = canon_validator.run_quality_gate(commit, snapshot_with_alice, conn)
    assert res["passed"] is False
    assert any("facts_add[0].subject_name" in e for e in res["errors"])


def test_rule_2_plot_move_to_node_id_must_exist(conn: sqlite3.Connection, snapshot_with_alice: dict[str, object]):
    commit: dict[str, object] = {"patch": {"plot_move": {"to_node_id": "missing", "beat_summary": "beat"}}}
    res = canon_validator.run_quality_gate(commit, snapshot_with_alice, conn)
    assert res["passed"] is False
    assert any("plot_move.to_node_id" in e for e in res["errors"])


def test_rule_3_commit_must_not_include_invariants(conn: sqlite3.Connection, snapshot_with_alice: dict[str, object]):
    commit: dict[str, object] = {"invariants": {"schema_version": 999}, "patch": {"notes": "x"}}
    res = canon_validator.run_quality_gate(commit, snapshot_with_alice, conn)
    assert res["passed"] is False
    assert any("invariants" in e for e in res["errors"])


def test_rule_4_asserted_predicate_duplicate_warns(conn: sqlite3.Connection, snapshot_with_alice: dict[str, object]):
    snapshot: dict[str, object] = dict(snapshot_with_alice)
    snapshot["facts"] = [
        {
            "subject_name": "Alice",
            "predicate": "likes",
            "object_value": "tea",
            "status": "asserted",
            "confidence": 1.0,
            "canonicity": "canon",
        }
    ]
    commit: dict[str, object] = {
        "patch": {
            "facts_add": [
                {
                    "subject_name": "Alice",
                    "predicate": "likes",
                    "object_value": "coffee",
                    "status": "asserted",
                    "confidence": 1.0,
                }
            ]
        }
    }
    res = canon_validator.run_quality_gate(commit, snapshot, conn)
    assert res["passed"] is True
    assert any("already asserted" in w for w in res["warnings"])


def test_rule_5_low_confidence_warns(conn: sqlite3.Connection, snapshot_with_alice: dict[str, object]):
    commit: dict[str, object] = {
        "patch": {
            "facts_add": [
                {
                    "subject_name": "Alice",
                    "predicate": "mood",
                    "object_value": "uncertain",
                    "status": "rumor",
                    "confidence": 0.2,
                }
            ]
        }
    }
    res = canon_validator.run_quality_gate(commit, snapshot_with_alice, conn)
    assert res["passed"] is True
    assert any("confidence" in w for w in res["warnings"])


def test_rule_6_retconned_in_facts_add_is_error(conn: sqlite3.Connection, snapshot_with_alice: dict[str, object]):
    commit: dict[str, object] = {
        "patch": {
            "facts_add": [
                {
                    "subject_name": "Alice",
                    "predicate": "exists",
                    "object_value": "true",
                    "status": "retconned",
                    "confidence": 0.0,
                }
            ]
        }
    }
    res = canon_validator.run_quality_gate(commit, snapshot_with_alice, conn)
    assert res["passed"] is False
    assert any("retconned" in e for e in res["errors"])


def test_validate_patch_schema_smoke():
    errs = canon_validator.validate_patch_schema({"plot_move": {"to_node_id": "n"}})
    assert any("plot_move.beat_summary" in e for e in errs)
