#!/usr/bin/env python3

from __future__ import annotations

import logging
import contextlib
import datetime as _dt
import json
import os
import sqlite3
import time
import uuid
from typing import Any, Callable, Iterator

logger = logging.getLogger(__name__)

from core.utils import now_ms
from canon.validator import validate_patch_schema

_now_ms = now_ms  # backward-compat alias for external importers

LATEST_SCHEMA_VERSION = 1

_db_path: str | None = None



def _utc_now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).replace(microsecond=0).isoformat()


def _uuid() -> str:
    return str(uuid.uuid4())


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _require_db_path() -> str:
    if not _db_path:
        raise RuntimeError("canon_store.init_db(db_path) must be called first")
    return _db_path


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(
        db_path,
        timeout=30.0,
        isolation_level=None,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextlib.contextmanager
def _db() -> Iterator[sqlite3.Connection]:
    conn = _connect(_require_db_path())
    try:
        yield conn
    finally:
        conn.close()


def _ensure_schema_version_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
    )


def _get_current_schema_version(conn: sqlite3.Connection) -> int:
    _ensure_schema_version_table(conn)
    row = conn.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()
    if not row or row["v"] is None:
        return 0
    return int(row["v"])


def _record_schema_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute(
        "INSERT INTO schema_version(version, applied_at) VALUES (?, ?)",
        (version, _utc_now_iso()),
    )


def _migration_001_create_all(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS world (
            world_id TEXT PRIMARY KEY,
            name TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS playthrough (
            play_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            name TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS plot_node (
            node_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            title TEXT,
            body TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS plot_edge (
            edge_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            from_node_id TEXT NOT NULL,
            to_node_id TEXT NOT NULL,
            kind TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE,
            FOREIGN KEY(from_node_id) REFERENCES plot_node(node_id) ON DELETE CASCADE,
            FOREIGN KEY(to_node_id) REFERENCES plot_node(node_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS branch (
            branch_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            play_id TEXT NOT NULL,
            name TEXT,
            head_rev_id TEXT,
            head_node_id TEXT,
            forked_from_branch_id TEXT,
            fork_base_rev_id TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE,
            FOREIGN KEY(play_id) REFERENCES playthrough(play_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS world_revision (
            rev_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            play_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            parent_rev_id TEXT,
            author TEXT NOT NULL,
            summary TEXT NOT NULL,
            trace_id TEXT,
            run_id TEXT,
            patch_json TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE,
            FOREIGN KEY(play_id) REFERENCES playthrough(play_id) ON DELETE CASCADE,
            FOREIGN KEY(parent_rev_id) REFERENCES world_revision(rev_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS entity (
            entity_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            canonical_description TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE,
            UNIQUE(world_id, type, name)
        );

        CREATE TABLE IF NOT EXISTS entity_alias (
            alias_id TEXT PRIMARY KEY,
            entity_id TEXT NOT NULL,
            alias TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(entity_id) REFERENCES entity(entity_id) ON DELETE CASCADE,
            UNIQUE(entity_id, alias)
        );

        CREATE TABLE IF NOT EXISTS fact (
            fact_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            subject_name TEXT NOT NULL,
            predicate TEXT NOT NULL,
            object_value TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('asserted','rumor','retconned')),
            confidence REAL NOT NULL,
            canonicity TEXT NOT NULL DEFAULT 'canon' CHECK(canonicity IN ('canon','fanon','speculation')),
            valid_from_rev_id TEXT NOT NULL,
            valid_until_rev_id TEXT,
            retcon_reason TEXT,
            retcon_rev_id TEXT,
            confirmed_by_rev_id TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE,
            FOREIGN KEY(valid_from_rev_id) REFERENCES world_revision(rev_id) ON DELETE CASCADE,
            FOREIGN KEY(valid_until_rev_id) REFERENCES world_revision(rev_id) ON DELETE SET NULL,
            FOREIGN KEY(retcon_rev_id) REFERENCES world_revision(rev_id) ON DELETE SET NULL,
            FOREIGN KEY(confirmed_by_rev_id) REFERENCES world_revision(rev_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS lorebook_entry (
            entry_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS character (
            character_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            name TEXT NOT NULL,
            canonical_description TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE,
            UNIQUE(world_id, name)
        );

        CREATE TABLE IF NOT EXISTS character_card_raw (
            card_id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL,
            raw_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(character_id) REFERENCES character(character_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS canon_conflict (
            conflict_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            play_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            base_rev_id TEXT,
            patch_a_json TEXT NOT NULL,
            patch_b_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
            resolution_kind TEXT,
            resolution_rev_id TEXT,
            resolved_at_ms INTEGER,
            note TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE,
            FOREIGN KEY(play_id) REFERENCES playthrough(play_id) ON DELETE CASCADE,
            FOREIGN KEY(branch_id) REFERENCES branch(branch_id) ON DELETE CASCADE,
            FOREIGN KEY(base_rev_id) REFERENCES world_revision(rev_id) ON DELETE SET NULL,
            FOREIGN KEY(resolution_rev_id) REFERENCES world_revision(rev_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS pending_commit (
            commit_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            play_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            base_rev_id TEXT,
            patch_json TEXT NOT NULL,
            author TEXT NOT NULL,
            summary TEXT NOT NULL,
            trace_id TEXT,
            run_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','conflicted','failed')),
            applied_rev_id TEXT,
            conflict_id TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE CASCADE,
            FOREIGN KEY(play_id) REFERENCES playthrough(play_id) ON DELETE CASCADE,
            FOREIGN KEY(branch_id) REFERENCES branch(branch_id) ON DELETE CASCADE,
            FOREIGN KEY(base_rev_id) REFERENCES world_revision(rev_id) ON DELETE SET NULL,
            FOREIGN KEY(applied_rev_id) REFERENCES world_revision(rev_id) ON DELETE SET NULL,
            FOREIGN KEY(conflict_id) REFERENCES canon_conflict(conflict_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS delegation_audit (
            audit_id TEXT PRIMARY KEY,
            world_id TEXT,
            run_id TEXT,
            event_kind TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS run (
            run_id TEXT PRIMARY KEY,
            trace_id TEXT,
            world_id TEXT,
            play_id TEXT,
            branch_id TEXT,
            speaker TEXT,
            base_rev_id TEXT,
            applied_rev_id TEXT,
            conflict_id TEXT,
            status TEXT NOT NULL CHECK(status IN ('pending','running','done','failed')),
            idempotency_key TEXT UNIQUE,
            session_id TEXT,
            message_offset INTEGER,
            reply_text TEXT,
            maid_commit_json TEXT,
            error_json TEXT,
            candidates_json TEXT,
            selected_candidate_idx INTEGER,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY(world_id) REFERENCES world(world_id) ON DELETE SET NULL,
            FOREIGN KEY(play_id) REFERENCES playthrough(play_id) ON DELETE SET NULL,
            FOREIGN KEY(branch_id) REFERENCES branch(branch_id) ON DELETE SET NULL,
            FOREIGN KEY(base_rev_id) REFERENCES world_revision(rev_id) ON DELETE SET NULL,
            FOREIGN KEY(applied_rev_id) REFERENCES world_revision(rev_id) ON DELETE SET NULL,
            FOREIGN KEY(conflict_id) REFERENCES canon_conflict(conflict_id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_world_revision_world_branch_created ON world_revision(world_id, branch_id, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_fact_world_active ON fact(world_id, subject_name, predicate, object_value, valid_until_rev_id);
        CREATE INDEX IF NOT EXISTS idx_entity_world_name ON entity(world_id, name);
        CREATE INDEX IF NOT EXISTS idx_conflict_branch_status ON canon_conflict(branch_id, status, created_at_ms);
        CREATE INDEX IF NOT EXISTS idx_pending_commit_branch_status ON pending_commit(branch_id, status, created_at_ms);
        """
    )


MIGRATIONS: dict[int, Callable[[sqlite3.Connection], None]] = {
    1: _migration_001_create_all,
}


def migrate_db(conn: sqlite3.Connection) -> None:
    current = _get_current_schema_version(conn)
    if current > LATEST_SCHEMA_VERSION:
        raise RuntimeError(
            f"DB schema_version {current} is newer than supported {LATEST_SCHEMA_VERSION}"
        )

    for version in range(current + 1, LATEST_SCHEMA_VERSION + 1):
        fn = MIGRATIONS.get(version)
        if not fn:
            raise RuntimeError(f"Missing migration for schema version {version}")
        fn(conn)
        _record_schema_version(conn, version)


def init_db(db_path: str) -> None:
    global _db_path
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    _db_path = db_path

    with _db() as conn:
        _ensure_schema_version_table(conn)
        migrate_db(conn)


def _empty_snapshot(world_id: str) -> dict[str, Any]:
    return {
        "world_id": world_id,
        "rev_id": None,
        "parent_rev_id": None,
        "created_at": None,
        "invariants": {"schema_version": LATEST_SCHEMA_VERSION},
        "entities": [],
        "facts": [],
        "plot": {"current_node_id": None, "beat_summary": None, "history": []},
        "recent_events": [],
    }


def _normalize_snapshot(snapshot: dict[str, Any] | None, world_id: str) -> dict[str, Any]:
    base = _empty_snapshot(world_id)
    if not snapshot:
        return base

    out = dict(base)
    for k in base.keys():
        if k in snapshot:
            out[k] = snapshot[k]

    if not isinstance(out.get("invariants"), dict):
        out["invariants"] = {"schema_version": LATEST_SCHEMA_VERSION}
    out["invariants"].setdefault("schema_version", LATEST_SCHEMA_VERSION)

    if not isinstance(out.get("entities"), list):
        out["entities"] = []
    if not isinstance(out.get("facts"), list):
        out["facts"] = []
    if not isinstance(out.get("plot"), dict):
        out["plot"] = {"current_node_id": None, "beat_summary": None, "history": []}
    out["plot"].setdefault("current_node_id", None)
    out["plot"].setdefault("beat_summary", None)
    out["plot"].setdefault("history", [])
    if not isinstance(out["plot"].get("history"), list):
        out["plot"]["history"] = []
    if not isinstance(out.get("recent_events"), list):
        out["recent_events"] = []
    return out


def _default_confidence(status: str) -> float:
    if status == "asserted":
        return 1.0
    if status == "rumor":
        return 0.5
    if status == "retconned":
        return 0.0
    return 0.0


def _ensure_world_play_branch(
    conn: sqlite3.Connection, world_id: str, play_id: str, branch_id: str
) -> sqlite3.Row:
    now = now_ms()
    conn.execute(
        "INSERT OR IGNORE INTO world(world_id, name, created_at_ms, updated_at_ms) VALUES (?,?,?,?)",
        (world_id, world_id, now, now),
    )
    conn.execute(
        "UPDATE world SET updated_at_ms=? WHERE world_id=?",
        (now, world_id),
    )
    conn.execute(
        "INSERT OR IGNORE INTO playthrough(play_id, world_id, name, created_at_ms, updated_at_ms) VALUES (?,?,?,?,?)",
        (play_id, world_id, play_id, now, now),
    )
    conn.execute(
        "UPDATE playthrough SET updated_at_ms=? WHERE play_id=?",
        (now, play_id),
    )
    conn.execute(
        "INSERT OR IGNORE INTO branch(branch_id, world_id, play_id, name, head_rev_id, head_node_id, forked_from_branch_id, fork_base_rev_id, created_at_ms, updated_at_ms) "
        "VALUES (?,?,?,?,NULL,NULL,NULL,NULL,?,?)",
        (branch_id, world_id, play_id, branch_id, now, now),
    )
    conn.execute(
        "UPDATE branch SET updated_at_ms=? WHERE branch_id=?",
        (now, branch_id),
    )
    row = conn.execute(
        "SELECT * FROM branch WHERE branch_id=? AND world_id=? AND play_id=?",
        (branch_id, world_id, play_id),
    ).fetchone()
    if not row:
        raise RuntimeError("Failed to load branch")
    return row


def _load_snapshot(conn: sqlite3.Connection, rev_id: str | None, world_id: str) -> dict[str, Any]:
    if not rev_id:
        return _empty_snapshot(world_id)
    row = conn.execute(
        "SELECT snapshot_json FROM world_revision WHERE rev_id=? AND world_id=?",
        (rev_id, world_id),
    ).fetchone()
    if not row:
        raise KeyError(f"Unknown base revision: {rev_id}")
    try:
        snap = json.loads(row["snapshot_json"])
    except Exception:
        snap = None
    return _normalize_snapshot(snap, world_id)


def preview_apply_patch(base_snapshot: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    world_id = base_snapshot.get("world_id") if isinstance(base_snapshot, dict) else None
    if not isinstance(world_id, str) or not world_id:
        world_id = ""
    snap = _normalize_snapshot(base_snapshot if isinstance(base_snapshot, dict) else None, world_id)
    patch = patch if isinstance(patch, dict) else {}

    entities_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for e in snap["entities"]:
        if isinstance(e, dict) and isinstance(e.get("type"), str) and isinstance(e.get("name"), str):
            ek = (e["type"], e["name"])
            entities_by_key[ek] = {
                "type": e["type"],
                "name": e["name"],
                "canonical_description": e.get("canonical_description"),
                "aliases": list(e.get("aliases") or []),
            }

    for e in patch.get("entities_add") or []:
        if not isinstance(e, dict):
            continue
        t = e.get("type")
        n = e.get("name")
        if not isinstance(t, str) or not isinstance(n, str) or not t or not n:
            continue
        ek = (t, n)
        ent = entities_by_key.get(ek) or {
            "type": t,
            "name": n,
            "canonical_description": None,
            "aliases": [],
        }
        if "canonical_description" in e and isinstance(e.get("canonical_description"), str):
            ent["canonical_description"] = e.get("canonical_description")
        aliases = e.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                if isinstance(a, str) and a and a not in ent["aliases"]:
                    ent["aliases"].append(a)
        entities_by_key[ek] = ent

    facts_by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for f in snap["facts"]:
        if (
            isinstance(f, dict)
            and isinstance(f.get("subject_name"), str)
            and isinstance(f.get("predicate"), str)
            and isinstance(f.get("object_value"), str)
        ):
            fk = (f["subject_name"], f["predicate"], f["object_value"])
            facts_by_key[fk] = {
                "subject_name": f["subject_name"],
                "predicate": f["predicate"],
                "object_value": f["object_value"],
                "status": f.get("status", "asserted"),
                "confidence": float(f.get("confidence", _default_confidence(f.get("status", "asserted")))),
                "canonicity": f.get("canonicity", "canon"),
            }

    for r in patch.get("facts_retire") or []:
        if not isinstance(r, dict):
            continue
        s = r.get("subject_name")
        p = r.get("predicate")
        o = r.get("object_value")
        if not (
            isinstance(s, str)
            and isinstance(p, str)
            and isinstance(o, str)
            and s
            and p
            and o
        ):
            continue
        s_s: str = s
        p_s: str = p
        o_s: str = o
        facts_by_key.pop((s_s, p_s, o_s), None)

    for f in patch.get("facts_add") or []:
        if not isinstance(f, dict):
            continue
        s = f.get("subject_name")
        p = f.get("predicate")
        o = f.get("object_value")
        status = f.get("status")
        if not (
            isinstance(s, str)
            and isinstance(p, str)
            and isinstance(o, str)
            and isinstance(status, str)
            and s
            and p
            and o
            and status
        ):
            continue
        if status not in ("asserted", "rumor", "retconned"):
            continue
        canonicity = f.get("canonicity") if isinstance(f.get("canonicity"), str) else "canon"
        if canonicity not in ("canon", "fanon", "speculation"):
            canonicity = "canon"
        confidence = f.get("confidence")
        if confidence is None:
            confidence_f = _default_confidence(status)
        else:
            try:
                confidence_f = float(confidence)
            except Exception:
                confidence_f = _default_confidence(status)
        s_s2: str = s
        p_s2: str = p
        o_s2: str = o
        fk: tuple[str, str, str] = (s_s2, p_s2, o_s2)
        if status == "retconned":
            facts_by_key.pop(fk, None)
        else:
            facts_by_key[fk] = {
                "subject_name": s,
                "predicate": p,
                "object_value": o,
                "status": status,
                "confidence": confidence_f,
                "canonicity": canonicity,
            }

    plot = dict(snap["plot"])
    if isinstance(patch.get("plot_move"), dict):
        to_node_id = patch["plot_move"].get("to_node_id")
        beat_summary = patch["plot_move"].get("beat_summary")
        if isinstance(to_node_id, str) and to_node_id and isinstance(beat_summary, str):
            plot["history"] = list(plot.get("history") or [])
            plot["history"].append(
                {
                    "from_node_id": plot.get("current_node_id"),
                    "to_node_id": to_node_id,
                    "beat_summary": beat_summary,
                }
            )
            plot["current_node_id"] = to_node_id
            plot["beat_summary"] = beat_summary

    recent_events = list(snap.get("recent_events") or [])
    if isinstance(patch.get("notes"), str) and patch.get("notes"):
        recent_events.append({"kind": "note", "text": patch["notes"]})
    if isinstance(patch.get("plot_move"), dict):
        recent_events.append({"kind": "plot_move"})

    entities_out = sorted(entities_by_key.values(), key=lambda x: (x.get("type") or "", x.get("name") or ""))
    for e in entities_out:
        e["aliases"] = sorted(set([a for a in (e.get("aliases") or []) if isinstance(a, str) and a]))

    facts_out = sorted(
        facts_by_key.values(), key=lambda x: (x.get("subject_name") or "", x.get("predicate") or "", x.get("object_value") or "")
    )

    out = {
        "world_id": world_id,
        "rev_id": snap.get("rev_id"),
        "parent_rev_id": snap.get("parent_rev_id"),
        "created_at": snap.get("created_at"),
        "invariants": snap.get("invariants"),
        "entities": entities_out,
        "facts": facts_out,
        "plot": plot,
        "recent_events": recent_events[-50:],
    }
    return out


def _create_conflict(
    conn: sqlite3.Connection,
    *,
    world_id: str,
    play_id: str,
    branch_id: str,
    kind: str,
    base_rev_id: str | None,
    patch_a: dict[str, Any],
    patch_b: dict[str, Any],
    note: str | None = None,
) -> str:
    conflict_id = _uuid()
    now = now_ms()
    conn.execute(
        "INSERT INTO canon_conflict(conflict_id, world_id, play_id, branch_id, kind, base_rev_id, patch_a_json, patch_b_json, status, note, created_at_ms, updated_at_ms) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            conflict_id,
            world_id,
            play_id,
            branch_id,
            kind,
            base_rev_id,
            _json_dumps(patch_a),
            _json_dumps(patch_b),
            "open",
            note,
            now,
            now,
        ),
    )
    return conflict_id


def get_branch_head(world_id: str, play_id: str, branch_id: str) -> dict[str, Any]:
    with _db() as conn:
        row = conn.execute(
            "SELECT branch_id, world_id, play_id, head_rev_id, head_node_id, forked_from_branch_id, fork_base_rev_id FROM branch WHERE branch_id=? AND world_id=? AND play_id=?",
            (branch_id, world_id, play_id),
        ).fetchone()
        if not row:
            return {
                "branch_id": branch_id,
                "world_id": world_id,
                "play_id": play_id,
                "head_rev_id": None,
                "head_node_id": None,
                "forked_from_branch_id": None,
                "fork_base_rev_id": None,
            }
        return dict(row)


def _apply_patch_to_db(
    conn: sqlite3.Connection,
    *,
    world_id: str,
    new_rev_id: str,
    patch: dict[str, Any],
    created_at_ms: int,
) -> None:
    for e in patch.get("entities_add") or []:
        if not isinstance(e, dict):
            continue
        t = e.get("type")
        n = e.get("name")
        if not isinstance(t, str) or not isinstance(n, str) or not t or not n:
            continue
        desc = e.get("canonical_description") if isinstance(e.get("canonical_description"), str) else None
        row = conn.execute(
            "SELECT entity_id FROM entity WHERE world_id=? AND type=? AND name=?",
            (world_id, t, n),
        ).fetchone()
        if row:
            entity_id = row["entity_id"]
            if desc is not None:
                conn.execute(
                    "UPDATE entity SET canonical_description=?, updated_at_ms=? WHERE entity_id=?",
                    (desc, created_at_ms, entity_id),
                )
        else:
            entity_id = _uuid()
            conn.execute(
                "INSERT INTO entity(entity_id, world_id, type, name, canonical_description, created_at_ms, updated_at_ms) VALUES (?,?,?,?,?,?,?)",
                (entity_id, world_id, t, n, desc, created_at_ms, created_at_ms),
            )

        aliases = e.get("aliases")
        if isinstance(aliases, list):
            for a in aliases:
                if isinstance(a, str) and a:
                    conn.execute(
                        "INSERT OR IGNORE INTO entity_alias(alias_id, entity_id, alias, created_at_ms) VALUES (?,?,?,?)",
                        (_uuid(), entity_id, a, created_at_ms),
                    )

    for r in patch.get("facts_retire") or []:
        if not isinstance(r, dict):
            continue
        s = r.get("subject_name")
        p = r.get("predicate")
        o = r.get("object_value")
        if not all(isinstance(x, str) and x for x in (s, p, o)):
            continue
        conn.execute(
            "UPDATE fact SET valid_until_rev_id=?, updated_at_ms=? "
            "WHERE world_id=? AND subject_name=? AND predicate=? AND object_value=? AND valid_until_rev_id IS NULL",
            (new_rev_id, created_at_ms, world_id, s, p, o),
        )

    for f in patch.get("facts_add") or []:
        if not isinstance(f, dict):
            continue
        s = f.get("subject_name")
        p = f.get("predicate")
        o = f.get("object_value")
        status = f.get("status")
        if not all(isinstance(x, str) and x for x in (s, p, o, status)):
            continue
        if status not in ("asserted", "rumor", "retconned"):
            continue
        canonicity = f.get("canonicity") if isinstance(f.get("canonicity"), str) else "canon"
        if canonicity not in ("canon", "fanon", "speculation"):
            canonicity = "canon"
        confidence = f.get("confidence")
        if confidence is None:
            confidence_f = _default_confidence(status)
        else:
            try:
                confidence_f = float(confidence)
            except Exception:
                confidence_f = _default_confidence(status)

        valid_until = new_rev_id if status == "retconned" else None
        retcon_rev_id = new_rev_id if status == "retconned" else None
        conn.execute(
            "INSERT INTO fact(fact_id, world_id, subject_name, predicate, object_value, status, confidence, canonicity, valid_from_rev_id, valid_until_rev_id, retcon_reason, retcon_rev_id, confirmed_by_rev_id, created_at_ms, updated_at_ms) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                _uuid(),
                world_id,
                s,
                p,
                o,
                status,
                confidence_f,
                canonicity,
                new_rev_id,
                valid_until,
                None,
                retcon_rev_id,
                None,
                created_at_ms,
                created_at_ms,
            ),
        )


def _active_entities_snapshot(conn: sqlite3.Connection, world_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT entity_id, type, name, canonical_description FROM entity WHERE world_id=? ORDER BY type, name",
        (world_id,),
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        aliases = conn.execute(
            "SELECT alias FROM entity_alias WHERE entity_id=? ORDER BY alias",
            (r["entity_id"],),
        ).fetchall()
        out.append(
            {
                "type": r["type"],
                "name": r["name"],
                "canonical_description": r["canonical_description"],
                "aliases": [a["alias"] for a in aliases],
            }
        )
    return out


def _active_facts_snapshot(conn: sqlite3.Connection, world_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT subject_name, predicate, object_value, status, confidence, canonicity "
        "FROM fact WHERE world_id=? AND valid_until_rev_id IS NULL AND status IN ('asserted','rumor') "
        "ORDER BY subject_name, predicate, object_value",
        (world_id,),
    ).fetchall()
    return [
        {
            "subject_name": r["subject_name"],
            "predicate": r["predicate"],
            "object_value": r["object_value"],
            "status": r["status"],
            "confidence": float(r["confidence"]),
            "canonicity": r["canonicity"],
        }
        for r in rows
    ]


def commit_revision(
    world_id: str,
    play_id: str,
    branch_id: str,
    base_rev_id: str | None,
    patch: dict[str, Any],
    author: str,
    summary: str,
    trace_id: str | None = None,
    run_id: str | None = None,
) -> dict:
    schema_errors = validate_patch_schema(patch)
    errors = [
        {"path": e.split(": ", 1)[0], "error": e.split(": ", 1)[1] if ": " in e else e}
        for e in schema_errors
    ]
    if errors:
        return {"ok": False, "reason": "validation", "errors": errors}
    if not isinstance(author, str) or not author:
        return {"ok": False, "reason": "validation", "errors": [{"path": "author", "error": "required"}]}
    if not isinstance(summary, str) or not summary:
        return {"ok": False, "reason": "validation", "errors": [{"path": "summary", "error": "required"}]}

    with _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            _ensure_world_play_branch(conn, world_id, play_id, branch_id)
            head = conn.execute(
                "SELECT head_rev_id, head_node_id FROM branch WHERE branch_id=? AND world_id=? AND play_id=?",
                (branch_id, world_id, play_id),
            ).fetchone()
            head_rev = head["head_rev_id"] if head else None
            head_node = head["head_node_id"] if head else None

            if head_rev != base_rev_id:
                conflict_id = _create_conflict(
                    conn,
                    world_id=world_id,
                    play_id=play_id,
                    branch_id=branch_id,
                    kind="stale-base",
                    base_rev_id=base_rev_id,
                    patch_a=patch,
                    patch_b={},
                )
                conn.execute("COMMIT")
                return {"ok": False, "conflict_id": conflict_id, "reason": "base_mismatch"}

            created_at_ms = now_ms()
            created_at_iso = _utc_now_iso()
            new_rev_id = _uuid()
            parent_rev_id = base_rev_id
            base_snapshot = _load_snapshot(conn, base_rev_id, world_id)

            patch_json = _json_dumps(patch)
            placeholder = _normalize_snapshot(base_snapshot, world_id)
            placeholder["world_id"] = world_id
            placeholder["rev_id"] = new_rev_id
            placeholder["parent_rev_id"] = parent_rev_id
            placeholder["created_at"] = created_at_iso
            placeholder["invariants"] = {"schema_version": LATEST_SCHEMA_VERSION}

            conn.execute(
                "INSERT INTO world_revision(rev_id, world_id, play_id, branch_id, parent_rev_id, author, summary, trace_id, run_id, patch_json, snapshot_json, created_at_ms) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    new_rev_id,
                    world_id,
                    play_id,
                    branch_id,
                    parent_rev_id,
                    author,
                    summary,
                    trace_id,
                    run_id,
                    patch_json,
                    _json_dumps(placeholder),
                    created_at_ms,
                ),
            )

            _apply_patch_to_db(
                conn,
                world_id=world_id,
                new_rev_id=new_rev_id,
                patch=patch,
                created_at_ms=created_at_ms,
            )

            new_snapshot = preview_apply_patch(base_snapshot, patch)
            new_snapshot["world_id"] = world_id
            new_snapshot["rev_id"] = new_rev_id
            new_snapshot["parent_rev_id"] = parent_rev_id
            new_snapshot["created_at"] = created_at_iso
            new_snapshot["invariants"] = {"schema_version": LATEST_SCHEMA_VERSION}

            new_snapshot["entities"] = _active_entities_snapshot(conn, world_id)
            new_snapshot["facts"] = _active_facts_snapshot(conn, world_id)

            if isinstance(patch.get("plot_move"), dict):
                to_node_id = patch["plot_move"].get("to_node_id")
                if isinstance(to_node_id, str) and to_node_id:
                    head_node = to_node_id
            if not isinstance(new_snapshot.get("plot"), dict):
                new_snapshot["plot"] = {"current_node_id": None, "beat_summary": None, "history": []}
            new_snapshot["plot"]["current_node_id"] = head_node

            snapshot_json = _json_dumps(_normalize_snapshot(new_snapshot, world_id))
            conn.execute(
                "UPDATE world_revision SET snapshot_json=? WHERE rev_id=?",
                (snapshot_json, new_rev_id),
            )

            upd = conn.execute(
                "UPDATE branch SET head_rev_id=?, head_node_id=?, updated_at_ms=? "
                "WHERE branch_id=? AND world_id=? AND play_id=? AND head_rev_id IS ?",
                (
                    new_rev_id,
                    head_node,
                    created_at_ms,
                    branch_id,
                    world_id,
                    play_id,
                    base_rev_id,
                ),
            )
            if upd.rowcount != 1:
                conn.execute("ROLLBACK")
                conn.execute("BEGIN IMMEDIATE")
                conflict_id = _create_conflict(
                    conn,
                    world_id=world_id,
                    play_id=play_id,
                    branch_id=branch_id,
                    kind="stale-base",
                    base_rev_id=base_rev_id,
                    patch_a=patch,
                    patch_b={},
                    note="compare-and-swap failed",
                )
                conn.execute("COMMIT")
                return {"ok": False, "conflict_id": conflict_id, "reason": "base_mismatch"}

            conn.execute("COMMIT")
            return {"ok": True, "rev_id": new_rev_id}
        except KeyError as e:
            conn.execute("ROLLBACK")
            return {
                "ok": False,
                "reason": "validation",
                "errors": [{"path": "base_rev_id", "error": str(e)}],
            }
        except Exception:
            conn.execute("ROLLBACK")
            raise


def apply_pending_commits(
    world_id: str,
    play_id: str,
    branch_id: str,
    ordered_commit_ids: list[str],
) -> list[dict]:
    results: list[dict] = []
    for commit_id in ordered_commit_ids:
        with _db() as conn:
            row = conn.execute(
                "SELECT * FROM pending_commit WHERE commit_id=? AND world_id=? AND play_id=? AND branch_id=?",
                (commit_id, world_id, play_id, branch_id),
            ).fetchone()
            if not row:
                results.append({"commit_id": commit_id, "ok": False, "reason": "not_found"})
                continue
            if row["status"] != "pending":
                results.append({"commit_id": commit_id, "ok": False, "reason": "not_pending"})
                continue
            try:
                patch = json.loads(row["patch_json"])
            except Exception:
                patch = {}
            base_rev_id = row["base_rev_id"]
            author = row["author"]
            summary = row["summary"]
            trace_id = row["trace_id"]
            run_id = row["run_id"]

        res = commit_revision(
            world_id,
            play_id,
            branch_id,
            base_rev_id,
            patch,
            author,
            summary,
            trace_id=trace_id,
            run_id=run_id,
        )
        now = now_ms()
        with _db() as conn2:
            conn2.execute("BEGIN IMMEDIATE")
            try:
                if res.get("ok"):
                    conn2.execute(
                        "UPDATE pending_commit SET status='applied', applied_rev_id=?, updated_at_ms=? WHERE commit_id=?",
                        (res.get("rev_id"), now, commit_id),
                    )
                elif res.get("conflict_id"):
                    conn2.execute(
                        "UPDATE pending_commit SET status='conflicted', conflict_id=?, updated_at_ms=? WHERE commit_id=?",
                        (res.get("conflict_id"), now, commit_id),
                    )
                else:
                    conn2.execute(
                        "UPDATE pending_commit SET status='failed', updated_at_ms=? WHERE commit_id=?",
                        (now, commit_id),
                    )
                conn2.execute("COMMIT")
            except Exception:
                conn2.execute("ROLLBACK")
                raise
        results.append({"commit_id": commit_id, **res})
    return results


def compare_commits(
    commit_a: dict[str, Any],
    commit_b: dict[str, Any],
    base_snapshot: dict[str, Any],
) -> dict[str, Any]:
    a_patch = commit_a.get("patch") if isinstance(commit_a, dict) else None
    b_patch = commit_b.get("patch") if isinstance(commit_b, dict) else None
    a_patch = a_patch if isinstance(a_patch, dict) else {}
    b_patch = b_patch if isinstance(b_patch, dict) else {}
    base = base_snapshot if isinstance(base_snapshot, dict) else {}
    a_snap = preview_apply_patch(base, a_patch)
    b_snap = preview_apply_patch(base, b_patch)

    def _keyed_facts(snap: dict[str, Any]) -> dict[tuple[str, str, str], dict[str, Any]]:
        out: dict[tuple[str, str, str], dict[str, Any]] = {}
        for f in snap.get("facts") or []:
            if isinstance(f, dict):
                s = f.get("subject_name")
                p = f.get("predicate")
                o = f.get("object_value")
                if (
                    isinstance(s, str)
                    and isinstance(p, str)
                    and isinstance(o, str)
                    and s
                    and p
                    and o
                ):
                    out[(s, p, o)] = f
        return out

    fa = _keyed_facts(a_snap)
    fb = _keyed_facts(b_snap)
    only_a = sorted(set(fa.keys()) - set(fb.keys()))
    only_b = sorted(set(fb.keys()) - set(fa.keys()))
    both = sorted(set(fa.keys()) & set(fb.keys()))
    changed: list[tuple[str, str, str]] = []
    for k in both:
        if _json_dumps(fa[k]) != _json_dumps(fb[k]):
            changed.append(k)

    return {
        "a_snapshot": a_snap,
        "b_snapshot": b_snap,
        "diff": {
            "facts_only_in_a": [list(k) for k in only_a],
            "facts_only_in_b": [list(k) for k in only_b],
            "facts_changed": [list(k) for k in changed],
        },
    }


def get_branch_common_ancestor(branch_a_id: str, branch_b_id: str) -> str | None:
    with _db() as conn:
        a = conn.execute(
            "SELECT head_rev_id, world_id FROM branch WHERE branch_id=?",
            (branch_a_id,),
        ).fetchone()
        b = conn.execute(
            "SELECT head_rev_id, world_id FROM branch WHERE branch_id=?",
            (branch_b_id,),
        ).fetchone()
        if not a or not b:
            return None
        if a["world_id"] != b["world_id"]:
            return None
        a_head = a["head_rev_id"]
        b_head = b["head_rev_id"]
        if not a_head or not b_head:
            return None

        ancestors: set[str] = set()
        cur = a_head
        while cur:
            ancestors.add(cur)
            row = conn.execute(
                "SELECT parent_rev_id FROM world_revision WHERE rev_id=?",
                (cur,),
            ).fetchone()
            cur = row["parent_rev_id"] if row else None

        cur = b_head
        while cur:
            if cur in ancestors:
                return cur
            row = conn.execute(
                "SELECT parent_rev_id FROM world_revision WHERE rev_id=?",
                (cur,),
            ).fetchone()
            cur = row["parent_rev_id"] if row else None
        return None


# ── public aliases for previously-private helpers ──────────────────────
get_db = _db
json_dumps = _json_dumps
generate_uuid = _uuid
require_db_path = _require_db_path
