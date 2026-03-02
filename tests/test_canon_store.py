import os
import sqlite3
import tempfile
import unittest
import contextlib
import canon.store as canon_store


TESTS_DIR = os.path.dirname(os.path.abspath(__file__))


class TestCanonStore(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(dir=TESTS_DIR)
        self.db_path = os.path.join(self._tmp.name, "maids.db")
        canon_store.init_db(self.db_path)

        self.world_id = "00000000-0000-0000-0000-000000000001"
        self.play_id = "00000000-0000-0000-0000-000000000002"
        self.branch_id = "00000000-0000-0000-0000-000000000003"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def test_linear_revision_chain_advances_head(self) -> None:
        patch1 = {
            "entities_add": [
                {
                    "type": "place",
                    "name": "Floating Manor",
                    "canonical_description": "A manor that drifts between worlds.",
                    "aliases": ["The Manor"],
                }
            ],
            "facts_add": [
                {
                    "subject_name": "Floating Manor",
                    "predicate": "exists",
                    "object_value": "true",
                    "status": "asserted",
                }
            ],
            "notes": "Genesis.",
        }
        r1 = canon_store.commit_revision(
            self.world_id,
            self.play_id,
            self.branch_id,
            None,
            patch1,
            author="tester",
            summary="init",
        )
        self.assertTrue(r1.get("ok"), r1)
        rev1 = r1.get("rev_id")
        self.assertIsInstance(rev1, str)

        head1 = canon_store.get_branch_head(self.world_id, self.play_id, self.branch_id)
        self.assertEqual(head1.get("head_rev_id"), rev1)

        patch2 = {
            "facts_add": [
                {
                    "subject_name": "Floating Manor",
                    "predicate": "location",
                    "object_value": "between worlds",
                    "status": "rumor",
                }
            ]
        }
        r2 = canon_store.commit_revision(
            self.world_id,
            self.play_id,
            self.branch_id,
            rev1,
            patch2,
            author="tester",
            summary="add rumor",
        )
        self.assertTrue(r2.get("ok"), r2)
        rev2 = r2.get("rev_id")
        self.assertIsInstance(rev2, str)
        self.assertNotEqual(rev1, rev2)

        head2 = canon_store.get_branch_head(self.world_id, self.play_id, self.branch_id)
        self.assertEqual(head2.get("head_rev_id"), rev2)

        with contextlib.closing(self._conn()) as conn:
            row = conn.execute(
                "SELECT parent_rev_id FROM world_revision WHERE rev_id=?",
                (rev2,),
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["parent_rev_id"], rev1)

    def test_conflict_detection_stale_base_creates_conflict_row(self) -> None:
        r1 = canon_store.commit_revision(
            self.world_id,
            self.play_id,
            self.branch_id,
            None,
            {"notes": "first"},
            author="tester",
            summary="first",
        )
        self.assertTrue(r1.get("ok"), r1)

        stale = canon_store.commit_revision(
            self.world_id,
            self.play_id,
            self.branch_id,
            None,
            {"notes": "stale"},
            author="tester",
            summary="stale",
        )
        self.assertFalse(stale.get("ok"), stale)
        self.assertEqual(stale.get("reason"), "base_mismatch")
        conflict_id = stale.get("conflict_id")
        self.assertIsInstance(conflict_id, str)

        with contextlib.closing(self._conn()) as conn:
            row = conn.execute(
                "SELECT kind, patch_a_json, patch_b_json, status FROM canon_conflict WHERE conflict_id=?",
                (conflict_id,),
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["kind"], "stale-base")
            self.assertEqual(row["status"], "open")
            self.assertEqual(row["patch_b_json"], "{}")


if __name__ == "__main__":
    unittest.main()
