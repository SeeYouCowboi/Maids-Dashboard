import os
import sqlite3
import tempfile
import threading
import unittest
import contextlib


TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
import canon.store as canon_store


class TestCanonConcurrency(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(dir=TESTS_DIR)
        self.db_path = os.path.join(self._tmp.name, "maids.db")
        canon_store.init_db(self.db_path)

        self.world_id = "00000000-0000-0000-0000-000000000011"
        self.play_id = "00000000-0000-0000-0000-000000000012"
        self.branch_id = "00000000-0000-0000-0000-000000000013"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def test_concurrent_commit_race_one_succeeds(self) -> None:
        base = canon_store.commit_revision(
            self.world_id,
            self.play_id,
            self.branch_id,
            None,
            {"notes": "base"},
            author="tester",
            summary="base",
        )
        self.assertTrue(base.get("ok"), base)
        base_rev = base.get("rev_id")

        barrier = threading.Barrier(2)
        results = []
        lock = threading.Lock()

        def worker(note: str) -> None:
            barrier.wait()
            res = canon_store.commit_revision(
                self.world_id,
                self.play_id,
                self.branch_id,
                base_rev,
                {"notes": note},
                author="tester",
                summary=note,
            )
            with lock:
                results.append(res)

        t1 = threading.Thread(target=worker, args=("a",))
        t2 = threading.Thread(target=worker, args=("b",))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        oks = [r for r in results if r.get("ok")]
        fails = [r for r in results if not r.get("ok")]
        self.assertEqual(len(oks), 1, results)
        self.assertEqual(len(fails), 1, results)
        self.assertEqual(fails[0].get("reason"), "base_mismatch")

        head = canon_store.get_branch_head(self.world_id, self.play_id, self.branch_id)
        self.assertEqual(head.get("head_rev_id"), oks[0].get("rev_id"))

        with contextlib.closing(self._conn()) as conn:
            rev_count = conn.execute(
                "SELECT COUNT(*) AS c FROM world_revision WHERE world_id=?",
                (self.world_id,),
            ).fetchone()["c"]
            self.assertEqual(rev_count, 2)


if __name__ == "__main__":
    unittest.main()
