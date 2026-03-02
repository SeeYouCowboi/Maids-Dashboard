import os
import sqlite3
import tempfile
import unittest


TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
import canon.store as canon_store


class TestSchemaMigration(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(dir=TESTS_DIR)
        self.db_path = os.path.join(self._tmp.name, "maids.db")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_v0_to_latest_migrates_without_data_loss(self) -> None:
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                "CREATE TABLE world (world_id TEXT PRIMARY KEY, name TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)"
            )
            conn.execute(
                "INSERT INTO world(world_id, name, created_at_ms, updated_at_ms) VALUES (?,?,?,?)",
                ("w", "World", 1, 1),
            )
            conn.commit()
        finally:
            conn.close()

        canon_store.init_db(self.db_path)

        conn2 = sqlite3.connect(self.db_path)
        conn2.row_factory = sqlite3.Row
        try:
            row = conn2.execute("SELECT name FROM world WHERE world_id='w'").fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["name"], "World")

            v = conn2.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()["v"]
            self.assertEqual(int(v), canon_store.LATEST_SCHEMA_VERSION)

            tables = {
                r["name"]
                for r in conn2.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            for name in (
                "schema_version",
                "world",
                "world_revision",
                "entity",
                "entity_alias",
                "fact",
                "plot_node",
                "plot_edge",
                "playthrough",
                "branch",
                "run",
                "canon_conflict",
                "pending_commit",
                "delegation_audit",
            ):
                self.assertIn(name, tables)
        finally:
            conn2.close()


if __name__ == "__main__":
    unittest.main()
