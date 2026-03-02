#!/usr/bin/env python3
from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from typing import Literal, cast


logger = logging.getLogger(__name__)
PatchDict = dict[str, object]
SnapshotDict = dict[str, object]
CommitDict = dict[str, object]

FactStatus = Literal["asserted", "rumor", "retconned"]
Canonicity = Literal["canon", "fanon", "speculation"]


def validate_patch_schema(patch: object) -> list[str]:
    errors: list[str] = []

    if not isinstance(patch, dict):
        return ["patch: must be an object"]
    patch_d = cast(dict[str, object], patch)

    allowed = {"entities_add", "facts_add", "facts_retire", "plot_move", "notes"}
    for k in patch_d.keys():
        if k not in allowed:
            errors.append(f"{k}: unknown key")

    if "entities_add" in patch_d:
        v = patch_d.get("entities_add")
        if not isinstance(v, list):
            errors.append("entities_add: must be a list")
        else:
            entities_add = cast(list[object], v)
            for i, e in enumerate(entities_add):
                pfx = f"entities_add[{i}]"
                if not isinstance(e, dict):
                    errors.append(f"{pfx}: must be an object")
                    continue
                e_d = cast(dict[str, object], e)
                t = e_d.get("type")
                if not isinstance(t, str) or not t:
                    errors.append(f"{pfx}.type: required string")
                n = e_d.get("name")
                if not isinstance(n, str) or not n:
                    errors.append(f"{pfx}.name: required string")
                if "canonical_description" in e_d and e_d["canonical_description"] is not None and not isinstance(
                    e_d["canonical_description"], str
                ):
                    errors.append(f"{pfx}.canonical_description: must be a string")
                if "aliases" in e_d:
                    a = e_d["aliases"]
                    if not isinstance(a, list):
                        errors.append(f"{pfx}.aliases: must be list[str]")
                    else:
                        aliases = cast(list[object], a)
                        if any((not isinstance(x, str) or not x) for x in aliases):
                            errors.append(f"{pfx}.aliases: must be list[str]")

    if "facts_add" in patch_d:
        v = patch_d.get("facts_add")
        if not isinstance(v, list):
            errors.append("facts_add: must be a list")
        else:
            facts_add = cast(list[object], v)
            for i, f in enumerate(facts_add):
                pfx = f"facts_add[{i}]"
                if not isinstance(f, dict):
                    errors.append(f"{pfx}: must be an object")
                    continue
                f_d = cast(dict[str, object], f)
                for key in ("subject_name", "predicate", "object_value", "status"):
                    v_any = f_d.get(key)
                    if not isinstance(v_any, str) or not v_any:
                        errors.append(f"{pfx}.{key}: required string")
                status_any = f_d.get("status")
                if isinstance(status_any, str) and status_any not in ("asserted", "rumor", "retconned"):
                    errors.append(f"{pfx}.status: invalid")
                if "confidence" in f_d and f_d["confidence"] is not None:
                    conf_any = f_d["confidence"]
                    try:
                        _ = float(conf_any)
                    except Exception:
                        errors.append(f"{pfx}.confidence: must be a number")
                if "canonicity" in f_d and f_d["canonicity"] is not None:
                    c = f_d["canonicity"]
                    if not isinstance(c, str) or c not in ("canon", "fanon", "speculation"):
                        errors.append(f"{pfx}.canonicity: invalid")

    if "facts_retire" in patch_d:
        v = patch_d.get("facts_retire")
        if not isinstance(v, list):
            errors.append("facts_retire: must be a list")
        else:
            facts_retire = cast(list[object], v)
            for i, f in enumerate(facts_retire):
                pfx = f"facts_retire[{i}]"
                if not isinstance(f, dict):
                    errors.append(f"{pfx}: must be an object")
                    continue
                f_d = cast(dict[str, object], f)
                for key in ("subject_name", "predicate", "object_value"):
                    v_any = f_d.get(key)
                    if not isinstance(v_any, str) or not v_any:
                        errors.append(f"{pfx}.{key}: required string")

    if "plot_move" in patch_d and patch_d.get("plot_move") is not None:
        pm = patch_d.get("plot_move")
        if not isinstance(pm, dict):
            errors.append("plot_move: must be an object")
        else:
            pm_d = cast(dict[str, object], pm)
            to_node_id = pm_d.get("to_node_id")
            if not isinstance(to_node_id, str) or not to_node_id:
                errors.append("plot_move.to_node_id: required string")
            beat_summary = pm_d.get("beat_summary")
            if not isinstance(beat_summary, str) or not beat_summary:
                errors.append("plot_move.beat_summary: required string")

    if "notes" in patch_d and patch_d.get("notes") is not None and not isinstance(patch_d.get("notes"), str):
        errors.append("notes: must be a string")

    return errors


def _coerce_patch_from_commit(commit: CommitDict) -> PatchDict:
    patch_any = commit.get("patch")
    if isinstance(patch_any, dict):
        return cast(dict[str, object], patch_any)
    return {}


def _conn_fetchone(conn: object, sql: str, params: Sequence[object]) -> object | None:
    try:
        execute = getattr(conn, "execute", None)
        if isinstance(execute, Callable):
            cur = cast(object, execute(sql, tuple(params)))
            fetchone = getattr(cur, "fetchone", None)
            if isinstance(fetchone, Callable):
                return cast(object, fetchone())
    except Exception:
        pass

    try:
        cursor_fn = getattr(conn, "cursor", None)
        if not isinstance(cursor_fn, Callable):
            return None
        cur2 = cast(object, cursor_fn())
        execute2 = getattr(cur2, "execute", None)
        fetchone2 = getattr(cur2, "fetchone", None)
        if not (isinstance(execute2, Callable) and isinstance(fetchone2, Callable)):
            return None
        execute2(sql, tuple(params))
        return cast(object, fetchone2())
    except Exception:
        return None


def run_quality_gate(commit: CommitDict, current_snapshot: SnapshotDict, conn: object) -> dict[str, object]:
    patch = _coerce_patch_from_commit(commit)
    errors: list[str] = []
    warnings: list[str] = []

    schema_errors = validate_patch_schema(patch)
    if schema_errors:
        errors.extend([f"schema: {e}" for e in schema_errors])

    if "invariants" in commit:
        errors.append("invariants: MAID_COMMIT must not include invariants")
    if "invariants" in patch:
        errors.append("patch.invariants: patches must not include invariants")

    entity_names: set[str] = set()
    entities_any = current_snapshot.get("entities")
    if isinstance(entities_any, list):
        entities_list = cast(list[object], entities_any)
        for e in entities_list:
            if not isinstance(e, dict):
                continue
            e_d = cast(dict[str, object], e)
            name_any = e_d.get("name")
            if isinstance(name_any, str) and name_any:
                entity_names.add(name_any)

    facts_add_any = patch.get("facts_add")
    facts_add: list[object] = cast(list[object], facts_add_any) if isinstance(facts_add_any, list) else []

    for i, f in enumerate(facts_add):
        if not isinstance(f, dict):
            continue
        f_d = cast(dict[str, object], f)
        s_any = f_d.get("subject_name")
        if isinstance(s_any, str) and s_any and s_any not in entity_names:
            errors.append(f"facts_add[{i}].subject_name: unknown entity '{s_any}'")

    for i, f in enumerate(facts_add):
        if not isinstance(f, dict):
            continue
        f_d = cast(dict[str, object], f)
        if f_d.get("status") == "retconned":
            errors.append(f"facts_add[{i}].status: retconned not allowed; use facts_retire")

    for i, f in enumerate(facts_add):
        if not isinstance(f, dict):
            continue
        f_d = cast(dict[str, object], f)
        if "confidence" not in f_d:
            continue
        try:
            conf_any = f_d.get("confidence")
            if conf_any is None:
                continue
            if not isinstance(conf_any, (int, float, str)):
                continue
            c = float(conf_any)
        except Exception:
            continue
        if c < 0.3:
            warnings.append(f"facts_add[{i}].confidence: low ({c})")

    plot_move = patch.get("plot_move")
    if isinstance(plot_move, dict):
        pm_d = cast(dict[str, object], plot_move)
        to_node_id = pm_d.get("to_node_id")
        if isinstance(to_node_id, str) and to_node_id:
            row = _conn_fetchone(conn, "SELECT 1 FROM plot_node WHERE node_id=?", (to_node_id,))
            if not row:
                errors.append(f"plot_move.to_node_id: unknown plot_node '{to_node_id}'")

    facts = current_snapshot.get("facts")
    asserted_counts: dict[tuple[str, str], int] = {}
    asserted_triples: dict[tuple[str, str, str], int] = {}
    if isinstance(facts, list):
        facts_list = cast(list[object], facts)
        for f in facts_list:
            if not isinstance(f, dict):
                continue
            f_d = cast(dict[str, object], f)
            if f_d.get("status") != "asserted":
                continue
            s_any = f_d.get("subject_name")
            p_any = f_d.get("predicate")
            o_any = f_d.get("object_value")
            if not (isinstance(s_any, str) and s_any):
                continue
            if not (isinstance(p_any, str) and p_any):
                continue
            if not (isinstance(o_any, str) and o_any):
                continue
            s = s_any
            p = p_any
            o = o_any
            key_sp: tuple[str, str] = (s, p)
            asserted_counts[key_sp] = asserted_counts.get(key_sp, 0) + 1
            key_3: tuple[str, str, str] = (s, p, o)
            asserted_triples[key_3] = asserted_triples.get(key_3, 0) + 1

    facts_retire_any = patch.get("facts_retire")
    facts_retire: list[object] = cast(list[object], facts_retire_any) if isinstance(facts_retire_any, list) else []
    for r in facts_retire:
        if not isinstance(r, dict):
            continue
        r_d = cast(dict[str, object], r)
        s_any = r_d.get("subject_name")
        p_any = r_d.get("predicate")
        o_any = r_d.get("object_value")
        if not (isinstance(s_any, str) and s_any):
            continue
        if not (isinstance(p_any, str) and p_any):
            continue
        if not (isinstance(o_any, str) and o_any):
            continue
        s = s_any
        p = p_any
        o = o_any
        k3: tuple[str, str, str] = (s, p, o)
        if asserted_triples.get(k3, 0) > 0:
            asserted_triples[k3] -= 1
            key_sp2: tuple[str, str] = (s, p)
            asserted_counts[key_sp2] = max(0, asserted_counts.get(key_sp2, 0) - 1)
            if asserted_counts.get(key_sp2, 0) == 0:
                _ = asserted_counts.pop(key_sp2, None)

    added_asserted: dict[tuple[str, str], int] = {}
    for i, f in enumerate(facts_add):
        if not isinstance(f, dict):
            continue
        f_d = cast(dict[str, object], f)
        if f_d.get("status") != "asserted":
            continue
        s_any = f_d.get("subject_name")
        p_any = f_d.get("predicate")
        if not (isinstance(s_any, str) and s_any):
            continue
        if not (isinstance(p_any, str) and p_any):
            continue
        s = s_any
        p = p_any
        key_sp_add: tuple[str, str] = (s, p)
        if asserted_counts.get(key_sp_add, 0) > 0 or added_asserted.get(key_sp_add, 0) > 0:
            warnings.append(f"facts_add[{i}]: asserted predicate already asserted for subject '{s}' ('{p}')")
        added_asserted[key_sp_add] = added_asserted.get(key_sp_add, 0) + 1

    passed = len(errors) == 0
    score = 1.0 - (0.15 * len(errors)) - (0.03 * len(warnings))
    if score < 0.0:
        score = 0.0
    if score > 1.0:
        score = 1.0

    return {"passed": passed, "errors": errors, "warnings": warnings, "score": float(score)}
