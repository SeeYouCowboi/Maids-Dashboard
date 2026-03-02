#!/usr/bin/env python3
"""End-to-end smoke test that validates the entire Manor Control Plane."""

import json
import os
import sqlite3
import tempfile
import canon.store as canon_store
import canon.validator as canon_validator
import delegation_classifier
import drift_detector
import event_log
import lorebook_engine
import maid_contract
import scene_packet


TESTS_DIR = os.path.dirname(os.path.abspath(__file__))


def test_smoke():
    """End-to-end smoke test for Manor Control Plane."""
    tmp = tempfile.TemporaryDirectory(dir=TESTS_DIR)
    db_path = os.path.join(tmp.name, "maids_smoke.db")
    event_log_path = os.path.join(tmp.name, "events.jsonl")
    conn = None

    try:
        # Step 1: Initialize DB
        print("Step 1: Initializing DB...")
        canon_store.init_db(db_path)
        
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        assert len(tables) >= 15, "Not enough tables"
        print("  [OK] DB initialized")

        # Step 2: Create world and branch
        print("Step 2: Creating world and branch...")
        world_id = "test-world"
        play_id = "test-play"
        branch_id = "test-branch"
        
        result = canon_store.commit_revision(
            world_id, play_id, branch_id, None,
            {"entities_add": [{"type": "place", "name": "Manor"}]},
            "tester", "init"
        )
        assert result.get("ok"), f"Failed: {result}"
        rev1_id = result["rev_id"]
        print(f"  [OK] World created")

        # Step 3: Commit with entities and facts
        print("Step 3: Committing revision...")
        result = canon_store.commit_revision(
            world_id, play_id, branch_id, rev1_id,
            {"facts_add": [{"subject_name": "Manor", "predicate": "is", "object_value": "haunted", "status": "asserted"}]},
            "tester", "add fact"
        )
        assert result.get("ok"), f"Failed: {result}"
        rev2_id = result["rev_id"]
        print(f"  [OK] Revision committed")

        # Step 4: Submit pending commit
        print("Step 4: Submitting pending commit...")
        now = canon_store._now_ms()
        conn.execute(
            "INSERT INTO pending_commit (commit_id, world_id, play_id, branch_id, base_rev_id, patch_json, author, summary, status, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            ("pc-1", world_id, play_id, branch_id, rev2_id, json.dumps({"facts_add": [{"subject_name": "Ghost", "predicate": "exists", "object_value": "true", "status": "asserted"}]}), "tester", "add ghost", now, now)
        )
        conn.commit()
        print("  [OK] Pending commit submitted")

        # Step 5: MAID_COMMIT parser
        print("Step 5: Testing MAID_COMMIT parser...")
        parsed = maid_contract.parse_maid_commit("MAID_COMMIT\n---\nentities_add:\n  - type: person\n    name: Test")
        assert len(parsed["entities_add"]) == 1
        print("  [OK] Parser works")

        # Step 6: Apply pending commits
        print("Step 6: Applying pending commits...")
        results = canon_store.apply_pending_commits(world_id, play_id, branch_id, ["pc-1"])
        assert results[0].get("ok"), f"Apply failed: {results}"
        print("  [OK] Pending commits applied")

        # Step 7: Verify branch head advanced
        print("Step 7: Verifying branch head...")
        head = canon_store.get_branch_head(world_id, play_id, branch_id)
        assert head["head_rev_id"] != rev1_id
        print("  [OK] Branch head advanced")

        # Step 8: Check no conflicts
        print("Step 8: Checking conflicts...")
        conflicts = conn.execute("SELECT * FROM canon_conflict WHERE branch_id=? AND status='open'", (branch_id,)).fetchall()
        assert len(conflicts) == 0
        print("  [OK] No conflicts")

        # Step 9: Verify facts queryable
        print("Step 9: Verifying facts queryable...")
        facts = conn.execute("SELECT * FROM fact WHERE world_id=? AND valid_until_rev_id IS NULL", (world_id,)).fetchall()
        assert len(facts) >= 2
        print("  [OK] Facts queryable")

        # Step 10: Event log append
        print("Step 10: Testing event log...")
        event = event_log.append_event("test", trace_id="t1", config={"eventLogPath": event_log_path})
        assert event["kind"] == "test"
        assert os.path.exists(event_log_path)
        print("  [OK] Event log works")

        # Step 11: Lorebook engine
        print("Step 11: Testing lorebook engine...")
        matched = lorebook_engine.match_lorebook_entries([{"content": "wizard magic"}], [{"id": "1", "triggers": ["wizard"], "content": "wizard info", "priority": 1}], 5, 100)
        assert len(matched) >= 1
        print("  [OK] Lorebook engine works")

        # Step 12: Scene packet
        print("Step 12: Testing scene packet...")
        packet = scene_packet.build_scene_packet({"world": "W", "invariants": "I", "scene": "S", "lore": "L"}, [], [])
        assert "[WORLD]" in packet
        print("  [OK] Scene packet works")

        # Step 13: Delegation classifier
        print("Step 13: Testing delegation classifier...")
        result = delegation_classifier.classify_delegation({"content": "hi", "message_count": 5}, {"drift_score": 0.2}, {})
        assert result == "maid"
        print("  [OK] Delegation classifier works")

        # Step 14: Drift detector
        print("Step 14: Testing drift detector...")
        score = drift_detector.compute_drift_score({"facts": {}, "entities": {}}, {"facts": {"a": 1}, "entities": {}}, [])
        assert 0 <= score <= 1
        print(f"  [OK] Drift detector works (score: {score:.2f})")

        # Step 15: Canon validator
        print("Step 15: Testing canon validator...")
        result = canon_validator.run_quality_gate({"patch": {}}, {"entities": []}, conn)
        assert "passed" in result
        print("  [OK] Canon validator works")

        # Integrity checks
        print("\nIntegrity checks...")

        # FK constraints - need fresh connection with FK enabled
        conn.close()
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("DELETE FROM world WHERE world_id=?", (world_id,))
        conn.commit()
        entities = conn.execute("SELECT * FROM entity WHERE world_id=?", (world_id,)).fetchall()
        assert len(entities) == 0, "FK cascade failed"
        print("  [OK] FK constraints work")

        # Revision chain linear
        w2, p2, b2 = "w2", "p2", "b2"
        r1 = canon_store.commit_revision(w2, p2, b2, None, {"entities_add": [{"type": "t", "name": "n"}]}, "t", "1")
        r2 = canon_store.commit_revision(w2, p2, b2, r1["rev_id"], {"entities_add": [{"type": "t", "name": "n2"}]}, "t", "2")
        p = conn.execute("SELECT parent_rev_id FROM world_revision WHERE rev_id=?", (r2["rev_id"],)).fetchone()
        assert p["parent_rev_id"] == r1["rev_id"]
        print("  [OK] Revision chain linear")

        # No duplicate facts
        dups = conn.execute("SELECT subject_name, predicate, object_value, COUNT(*) c FROM fact WHERE world_id=? AND valid_until_rev_id IS NULL GROUP BY subject_name, predicate, object_value HAVING c > 1", (w2,)).fetchall()
        assert len(dups) == 0
        print("  [OK] No duplicate facts")

        conn.close()
        tmp.cleanup()
        
        print("\n" + "="*50)
        print("SMOKE TEST PASSED")
        print("="*50)

    except Exception as e:
        if conn:
            conn.close()
        tmp.cleanup()
        print(f"\nSMOKE TEST FAILED: {e}")
        raise


if __name__ == "__main__":
    test_smoke()
