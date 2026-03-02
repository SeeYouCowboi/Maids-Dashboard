#!/usr/bin/env python3
"""Tests for plot_graph module."""

import os
import tempfile
import unittest

from canon.store import init_db, _db, _now_ms
import plot_graph


def _create_world(world_id: str) -> None:
    """Helper to create a world for testing."""
    with _db() as conn:
        now = _now_ms()
        conn.execute(
            "INSERT INTO world (world_id, name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)",
            (world_id, world_id, now, now)
        )


def _create_playthrough(play_id: str, world_id: str) -> None:
    """Helper to create a playthrough for testing."""
    with _db() as conn:
        now = _now_ms()
        conn.execute(
            "INSERT INTO playthrough (play_id, world_id, name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)",
            (play_id, world_id, play_id, now, now)
        )


class TestPlotGraph(unittest.TestCase):
    """Test plot graph and branching model."""

    def setUp(self):
        """Set up test database."""
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        init_db(self.db_path)
        self.world_id = "test-world"
        self.play_id = "test-play"
        _create_world(self.world_id)
        _create_playthrough(self.play_id, self.world_id)

    def tearDown(self):
        """Clean up test database."""
        os.close(self.db_fd)
        os.unlink(self.db_path)

    def test_create_plot_node(self):
        """Test creating a plot node."""
        node_id = plot_graph.create_plot_node(
            world_id=self.world_id,
            title="Test Node",
            body="Test body content"
        )
        self.assertIsNotNone(node_id)

        node = plot_graph.get_plot_node(node_id)
        self.assertIsNotNone(node)
        self.assertEqual(node["title"], "Test Node")
        self.assertEqual(node["body"], "Test body content")

    def test_create_plot_edge(self):
        """Test creating a plot edge between nodes."""
        node_a = plot_graph.create_plot_node(
            world_id=self.world_id,
            title="Node A"
        )
        node_b = plot_graph.create_plot_node(
            world_id=self.world_id,
            title="Node B"
        )

        edge_id = plot_graph.create_plot_edge(
            world_id=self.world_id,
            from_node_id=node_a,
            to_node_id=node_b,
            kind="choice"
        )
        self.assertIsNotNone(edge_id)

        edges = plot_graph.get_plot_edges(self.world_id)
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["from_node_id"], node_a)
        self.assertEqual(edges[0]["to_node_id"], node_b)
        self.assertEqual(edges[0]["kind"], "choice")

    def test_delete_node_success(self):
        """Test deleting an unprotected node."""
        node_id = plot_graph.create_plot_node(
            world_id=self.world_id,
            title="Deletable Node"
        )

        errors = plot_graph.delete_node(node_id)
        self.assertEqual(len(errors), 0)

        # Verify node is gone
        node = plot_graph.get_plot_node(node_id)
        self.assertIsNone(node)

    def test_delete_node_protected_by_branch(self):
        """Test that nodes protected by branch heads cannot be deleted."""
        # Create a node
        node_id = plot_graph.create_plot_node(
            world_id=self.world_id,
            title="Protected Node"
        )

        # Create branch with head_node_id pointing to our node
        with _db() as conn:
            now = _now_ms()
            branch_id = "test-branch-1"
            conn.execute(
                """INSERT INTO branch (branch_id, world_id, play_id, name, head_node_id, created_at_ms, updated_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (branch_id, self.world_id, self.play_id, "main", node_id, now, now)
            )

        # Attempt to delete should fail
        errors = plot_graph.delete_node(node_id)
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["error"], "protected")
        self.assertEqual(errors[0]["branch_id"], branch_id)

        # Node should still exist
        node = plot_graph.get_plot_node(node_id)
        self.assertIsNotNone(node)

    def test_fork_branch(self):
        """Test forking a branch."""
        with _db() as conn:
            now = _now_ms()
            # First create the source branch (use NULL for head_rev_id/head_node_id)
            source_branch_id = "source-branch"
            conn.execute(
                """INSERT INTO branch (branch_id, world_id, play_id, name, head_rev_id, head_node_id, created_at_ms, updated_at_ms)
                   VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)""",
                (source_branch_id, self.world_id, self.play_id, "source", now, now)
            )

        # Fork the branch
        new_branch_id = plot_graph.fork_branch(source_branch_id, "forked-branch")
        self.assertIsNotNone(new_branch_id)
        self.assertNotEqual(new_branch_id, source_branch_id)

        # Verify forked branch has correct properties
        forked = plot_graph.get_branch(new_branch_id)
        self.assertIsNotNone(forked)
        self.assertEqual(forked["name"], "forked-branch")
        self.assertIsNone(forked["head_rev_id"])
        self.assertIsNone(forked["head_node_id"])
        self.assertEqual(forked["forked_from_branch_id"], source_branch_id)
        self.assertIsNone(forked["fork_base_rev_id"])

    def test_get_branch_common_ancestor(self):
        """Test finding common ancestor of two branches."""
        with _db() as conn:
            now = _now_ms()

            # First create the branches
            conn.execute(
                """INSERT INTO branch (branch_id, world_id, play_id, name, head_rev_id, created_at_ms, updated_at_ms)
                   VALUES (?, ?, ?, ?, NULL, ?, ?)""",
                ("branch-a", self.world_id, self.play_id, "branch-a", now, now)
            )
            conn.execute(
                """INSERT INTO branch (branch_id, world_id, play_id, name, head_rev_id, created_at_ms, updated_at_ms)
                   VALUES (?, ?, ?, ?, NULL, ?, ?)""",
                ("branch-b", self.world_id, self.play_id, "branch-b", now, now)
            )

            # Create revision chain: rev1 -> rev2 -> rev3
            conn.execute(
                """INSERT INTO world_revision 
                   (rev_id, world_id, play_id, branch_id, parent_rev_id, author, summary, patch_json, snapshot_json, created_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("rev1", self.world_id, self.play_id, "branch-a", None, "test", "initial", "{}", "{}", now)
            )
            conn.execute(
                """INSERT INTO world_revision 
                   (rev_id, world_id, play_id, branch_id, parent_rev_id, author, summary, patch_json, snapshot_json, created_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("rev2", self.world_id, self.play_id, "branch-a", "rev1", "test", "change1", "{}", "{}", now)
            )
            conn.execute(
                """INSERT INTO world_revision 
                   (rev_id, world_id, play_id, branch_id, parent_rev_id, author, summary, patch_json, snapshot_json, created_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("rev3", self.world_id, self.play_id, "branch-b", "rev2", "test", "change2", "{}", "{}", now)
            )

            # Update branch heads
            conn.execute(
                "UPDATE branch SET head_rev_id=? WHERE branch_id=?",
                ("rev2", "branch-a")
            )
            conn.execute(
                "UPDATE branch SET head_rev_id=? WHERE branch_id=?",
                ("rev3", "branch-b")
            )

        # Find common ancestor
        ancestor = plot_graph.get_branch_common_ancestor("branch-a", "branch-b")
        self.assertEqual(ancestor, "rev2")

    def test_get_branch_common_ancestor_no_common(self):
        """Test common ancestor when branches have no shared history."""
        with _db() as conn:
            now = _now_ms()

            # First create branches
            conn.execute(
                """INSERT INTO branch (branch_id, world_id, play_id, name, head_rev_id, created_at_ms, updated_at_ms)
                   VALUES (?, ?, ?, ?, NULL, ?, ?)""",
                ("branch-x", self.world_id, self.play_id, "branch-x", now, now)
            )
            conn.execute(
                """INSERT INTO branch (branch_id, world_id, play_id, name, head_rev_id, created_at_ms, updated_at_ms)
                   VALUES (?, ?, ?, ?, NULL, ?, ?)""",
                ("branch-y", self.world_id, self.play_id, "branch-y", now, now)
            )

            # Create separate revision chains
            conn.execute(
                """INSERT INTO world_revision 
                   (rev_id, world_id, play_id, branch_id, parent_rev_id, author, summary, patch_json, snapshot_json, created_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("rev-a1", self.world_id, self.play_id, "branch-x", None, "test", "init-a", "{}", "{}", now)
            )
            conn.execute(
                """INSERT INTO world_revision 
                   (rev_id, world_id, play_id, branch_id, parent_rev_id, author, summary, patch_json, snapshot_json, created_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("rev-b1", self.world_id, self.play_id, "branch-y", None, "test", "init-b", "{}", "{}", now)
            )

            # Update branch heads
            conn.execute(
                "UPDATE branch SET head_rev_id=? WHERE branch_id=?",
                ("rev-a1", "branch-x")
            )
            conn.execute(
                "UPDATE branch SET head_rev_id=? WHERE branch_id=?",
                ("rev-b1", "branch-y")
            )

        # No common ancestor
        ancestor = plot_graph.get_branch_common_ancestor("branch-x", "branch-y")
        self.assertIsNone(ancestor)


class TestAdvanceBranch(unittest.TestCase):
    """Test branch advancement."""

    def setUp(self):
        """Set up test database."""
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        init_db(self.db_path)
        self.world_id = "test-world"
        self.play_id = "test-play"
        _create_world(self.world_id)
        _create_playthrough(self.play_id, self.world_id)

    def tearDown(self):
        """Clean up test database."""
        os.close(self.db_fd)
        os.unlink(self.db_path)

    def test_advance_branch_creates_revision(self):
        """Test advancing branch creates a new revision."""
        # Create initial node and branch
        node1 = plot_graph.create_plot_node(self.world_id, "Start")
        node2 = plot_graph.create_plot_node(self.world_id, "End")

        with _db() as conn:
            now = _now_ms()
            # First create the branch
            branch_id = "main"
            conn.execute(
                """INSERT INTO branch (branch_id, world_id, play_id, name, head_rev_id, head_node_id, created_at_ms, updated_at_ms)
                   VALUES (?, ?, ?, ?, NULL, ?, ?, ?)""",
                (branch_id, self.world_id, self.play_id, "main", node1, now, now)
            )
            # Create initial commit/revision
            rev_id = "initial-rev"
            conn.execute(
                """INSERT INTO world_revision 
                   (rev_id, world_id, play_id, branch_id, parent_rev_id, author, summary, patch_json, snapshot_json, created_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (rev_id, self.world_id, self.play_id, "main", None, "test", "initial", "{}", "{}", now)
            )
            # Update branch head
            conn.execute(
                "UPDATE branch SET head_rev_id=? WHERE branch_id=?",
                (rev_id, branch_id)
            )

        # Advance branch to node2
        result = plot_graph.advance_branch(
            branch_id="main",
            to_node_id=node2,
            summary="Moved to end node"
        )

        self.assertTrue(result["ok"])
        self.assertIn("rev_id", result)

        # Verify branch head updated
        branch = plot_graph.get_branch("main")
        self.assertEqual(branch["head_node_id"], node2)


class TestMergeBranch(unittest.TestCase):
    """Test branch merging."""

    def setUp(self):
        """Set up test database."""
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        init_db(self.db_path)
        self.world_id = "test-world"
        self.play_id = "test-play"
        _create_world(self.world_id)
        _create_playthrough(self.play_id, self.world_id)

    def tearDown(self):
        """Clean up test database."""
        os.close(self.db_fd)
        os.unlink(self.db_path)

    def test_merge_fast_forward(self):
        """Test fast-forward merge when target is ancestor."""
        with _db() as conn:
            now = _now_ms()

            # First create branches
            conn.execute(
                """INSERT INTO branch (branch_id, world_id, play_id, name, head_rev_id, created_at_ms, updated_at_ms)
                   VALUES (?, ?, ?, ?, NULL, ?, ?)""",
                ("source", self.world_id, self.play_id, "source", now, now)
            )
            conn.execute(
                """INSERT INTO branch (branch_id, world_id, play_id, name, head_rev_id, created_at_ms, updated_at_ms)
                   VALUES (?, ?, ?, ?, NULL, ?, ?)""",
                ("target", self.world_id, self.play_id, "target", now, now)
            )

            # Create revision chain: rev1 -> rev2 -> rev3
            conn.execute(
                """INSERT INTO world_revision 
                   (rev_id, world_id, play_id, branch_id, parent_rev_id, author, summary, patch_json, snapshot_json, created_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("rev-1", self.world_id, self.play_id, "source", None, "test", "v1", "{}", "{}", now)
            )
            conn.execute(
                """INSERT INTO world_revision 
                   (rev_id, world_id, play_id, branch_id, parent_rev_id, author, summary, patch_json, snapshot_json, created_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("rev-2", self.world_id, self.play_id, "source", "rev-1", "test", "v2", "{}", "{}", now)
            )
            conn.execute(
                """INSERT INTO world_revision 
                   (rev_id, world_id, play_id, branch_id, parent_rev_id, author, summary, patch_json, snapshot_json, created_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("rev-3", self.world_id, self.play_id, "source", "rev-2", "test", "v3", "{}", "{}", now)
            )

            # Update branch heads: target at rev-1, source at rev-3
            conn.execute(
                "UPDATE branch SET head_rev_id=? WHERE branch_id=?",
                ("rev-1", "target")
            )
            conn.execute(
                "UPDATE branch SET head_rev_id=? WHERE branch_id=?",
                ("rev-3", "source")
            )

        # Merge source into target - should fast-forward
        result = plot_graph.merge_branch("source", "target")

        self.assertTrue(result["ok"])
        self.assertEqual(result["type"], "fast_forward")

        # Verify target advanced
        target = plot_graph.get_branch("target")
        self.assertEqual(target["head_rev_id"], "rev-3")


if __name__ == "__main__":
    unittest.main()
