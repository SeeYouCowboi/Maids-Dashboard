#!/usr/bin/env python3
"""Plot graph and branching model for MAIDS dashboard."""

from __future__ import annotations

import logging
import sqlite3
import uuid
from typing import Any

logger = logging.getLogger(__name__)

from canon.store import (
    commit_revision,
    get_db,
    generate_uuid,
    get_branch_head,
    now_ms,
    preview_apply_patch,
    require_db_path,
)


def advance_branch(
    branch_id: str,
    to_node_id: str,
    summary: str,
    trace_id: str | None = None,
) -> dict[str, Any]:
    """Move branch head to a new node.

    Args:
        branch_id: The branch to advance
        to_node_id: Target node ID to move to
        summary: Description of this advancement
        trace_id: Optional trace ID for tracking

    Returns:
        Dict with 'ok' boolean and either 'rev_id' or 'error' details
    """
    with get_db() as conn:
        # Verify node exists
        node_row = conn.execute(
            "SELECT node_id, world_id FROM plot_node WHERE node_id=?",
            (to_node_id,)
        ).fetchone()
        if not node_row:
            return {"ok": False, "error": f"Node not found: {to_node_id}"}

        world_id = node_row["world_id"]

        # Get branch info
        branch_row = conn.execute(
            "SELECT branch_id, world_id, play_id, head_rev_id, head_node_id "
            "FROM branch WHERE branch_id=?",
            (branch_id,)
        ).fetchone()
        if not branch_row:
            return {"ok": False, "error": f"Branch not found: {branch_id}"}

        if branch_row["world_id"] != world_id:
            return {"ok": False, "error": "Branch and node are from different worlds"}

        play_id = branch_row["play_id"]
        current_head_rev_id = branch_row["head_rev_id"]
        current_head_node_id = branch_row["head_node_id"]

        # Create patch for plot move
        patch = {
            "plot_move": {
                "to_node_id": to_node_id,
                "beat_summary": summary,
            }
        }

        # Commit the revision
        result = commit_revision(
            world_id=world_id,
            play_id=play_id,
            branch_id=branch_id,
            base_rev_id=current_head_rev_id,
            patch=patch,
            author="system",
            summary=summary,
            trace_id=trace_id,
        )

        if result.get("ok"):
            return {"ok": True, "rev_id": result.get("rev_id")}
        else:
            return {"ok": False, "error": result.get("reason"), "details": result}


def fork_branch(source_branch_id: str, name: str) -> str:
    """Create a new branch inheriting source branch state.

    The new branch inherits:
    - head_rev_id from source
    - head_node_id from source
    - Sets forked_from_branch_id to source_branch_id
    - Sets fork_base_rev_id to source's head_rev_id

    Args:
        source_branch_id: Branch to fork from
        name: Name for the new branch

    Returns:
        New branch_id

    Raises:
        ValueError: If source branch not found
    """
    with get_db() as conn:
        # Get source branch
        source = conn.execute(
            "SELECT * FROM branch WHERE branch_id=?",
            (source_branch_id,)
        ).fetchone()
        if not source:
            raise ValueError(f"Source branch not found: {source_branch_id}")

        new_branch_id = generate_uuid()
        now = now_ms()

        conn.execute(
            """INSERT INTO branch (
                branch_id, world_id, play_id, name,
                head_rev_id, head_node_id,
                forked_from_branch_id, fork_base_rev_id,
                created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                new_branch_id,
                source["world_id"],
                source["play_id"],
                name,
                source["head_rev_id"],
                source["head_node_id"],
                source_branch_id,
                source["head_rev_id"],
                now,
                now,
            )
        )

        return new_branch_id


def _is_ancestor(conn: sqlite3.Connection, ancestor_rev_id: str, descendant_rev_id: str) -> bool:
    """Check if ancestor_rev_id is an ancestor of descendant_rev_id."""
    if not ancestor_rev_id or not descendant_rev_id:
        return False
    if ancestor_rev_id == descendant_rev_id:
        return True

    ancestors: set = set()
    cur = descendant_rev_id
    while cur:
        ancestors.add(cur)
        row = conn.execute(
            "SELECT parent_rev_id FROM world_revision WHERE rev_id=?",
            (cur,)
        ).fetchone()
        cur = row["parent_rev_id"] if row else None

    return ancestor_rev_id in ancestors


def merge_branch(source_branch_id: str, target_branch_id: str) -> dict[str, Any]:
    """Merge source branch into target branch.

    Fast-forward merge: if target head is ancestor of source head, advance target.
    Otherwise, create a canon_conflict with patches.

    Args:
        source_branch_id: Branch to merge from
        target_branch_id: Branch to merge into

    Returns:
        Dict with merge result details
    """
    import json
    import sqlite3

    with get_db() as conn:
        # Get both branches
        source = conn.execute(
            "SELECT * FROM branch WHERE branch_id=?",
            (source_branch_id,)
        ).fetchone()
        target = conn.execute(
            "SELECT * FROM branch WHERE branch_id=?",
            (target_branch_id,)
        ).fetchone()

        if not source:
            return {"ok": False, "error": f"Source branch not found: {source_branch_id}"}
        if not target:
            return {"ok": False, "error": f"Target branch not found: {target_branch_id}"}

        if source["world_id"] != target["world_id"]:
            return {"ok": False, "error": "Branches from different worlds"}
        if source["play_id"] != target["play_id"]:
            return {"ok": False, "error": "Branches from different playthroughs"}

        source_head = source["head_rev_id"]
        target_head = target["head_rev_id"]

        # Fast-forward: if target is ancestor of source
        if target_head and source_head and _is_ancestor(conn, target_head, source_head):
            # Advance target to source's head
            now = now_ms()
            conn.execute(
                """UPDATE branch SET
                    head_rev_id=?, head_node_id=?, updated_at_ms=?
                    WHERE branch_id=?""",
                (source_head, source["head_node_id"], now, target_branch_id)
            )
            return {"ok": True, "type": "fast_forward", "target_branch_id": target_branch_id}

        # Create conflict
        # Get patches for both branches from common ancestor
        common_ancestor = None
        if target_head and source_head:
            # Find common ancestor
            ancestors: set = set()
            cur = source_head
            while cur:
                ancestors.add(cur)
                row = conn.execute(
                    "SELECT parent_rev_id FROM world_revision WHERE rev_id=?",
                    (cur,)
                ).fetchone()
                cur = row["parent_rev_id"] if row else None

            cur = target_head
            while cur:
                if cur in ancestors:
                    common_ancestor = cur
                    break
                row = conn.execute(
                    "SELECT parent_rev_id FROM world_revision WHERE rev_id=?",
                    (cur,)
                ).fetchone()
                cur = row["parent_rev_id"] if row else None

        # Get patches for both branches
        source_patch = {}
        if source_head:
            rev = conn.execute(
                "SELECT patch_json FROM world_revision WHERE rev_id=?",
                (source_head,)
            ).fetchone()
            if rev:
                try:
                    source_patch = json.loads(rev["patch_json"])
                except Exception:
                    source_patch = {}

        target_patch = {}
        if target_head:
            rev = conn.execute(
                "SELECT patch_json FROM world_revision WHERE rev_id=?",
                (target_head,)
            ).fetchone()
            if rev:
                try:
                    target_patch = json.loads(rev["patch_json"])
                except Exception:
                    target_patch = {}

        # Create conflict
        conflict_id = generate_uuid()
        now = now_ms()
        conn.execute(
            """INSERT INTO canon_conflict (
                conflict_id, world_id, play_id, branch_id,
                kind, base_rev_id,
                patch_a_json, patch_b_json,
                status, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                conflict_id,
                source["world_id"],
                source["play_id"],
                target_branch_id,
                "plot-merge",
                common_ancestor,
                json.dumps(source_patch),
                json.dumps(target_patch),
                "open",
                now,
                now,
            )
        )

        return {
            "ok": True,
            "type": "conflict",
            "conflict_id": conflict_id,
            "target_branch_id": target_branch_id,
        }


def delete_node(node_id: str) -> list[dict[str, str]]:
    """Delete a plot node.

    Returns error list if node is protected (any branch head points to it).
    Only unprotected nodes are deleted.

    Args:
        node_id: Node to delete

    Returns:
        List of errors (empty if successful)
    """
    errors: list[dict[str, str]] = []

    with get_db() as conn:
        # Check if node exists
        node = conn.execute(
            "SELECT node_id FROM plot_node WHERE node_id=?",
            (node_id,)
        ).fetchone()
        if not node:
            errors.append({"node_id": node_id, "error": "Node not found"})
            return errors

        # Check if any branch has this as head_node_id
        protected_branches = conn.execute(
            "SELECT branch_id, name FROM branch WHERE head_node_id=?",
            (node_id,)
        ).fetchall()

        if protected_branches:
            for b in protected_branches:
                errors.append({
                    "node_id": node_id,
                    "error": "protected",
                    "branch_id": b["branch_id"],
                    "branch_name": b["name"],
                })
            return errors

        # Delete edges involving this node
        conn.execute(
            "DELETE FROM plot_edge WHERE from_node_id=? OR to_node_id=?",
            (node_id, node_id)
        )

        # Delete the node
        conn.execute(
            "DELETE FROM plot_node WHERE node_id=?",
            (node_id,)
        )

    return errors


def get_branch_common_ancestor(branch_a_id: str, branch_b_id: str) -> str | None:
    """Get common ancestor revision ID of two branches.

    Args:
        branch_a_id: First branch
        branch_b_id: Second branch

    Returns:
        Common ancestor rev_id, or None if no common ancestor
    """
    with get_db() as conn:
        a = conn.execute(
            "SELECT head_rev_id, world_id, play_id FROM branch WHERE branch_id=?",
            (branch_a_id,)
        ).fetchone()
        b = conn.execute(
            "SELECT head_rev_id, world_id, play_id FROM branch WHERE branch_id=?",
            (branch_b_id,)
        ).fetchone()

        if not a or not b:
            return None
        if a["world_id"] != b["world_id"]:
            return None
        if a["play_id"] != b["play_id"]:
            return None

        a_head = a["head_rev_id"]
        b_head = b["head_rev_id"]

        if not a_head or not b_head:
            return None

        # Build ancestor set for branch A
        ancestors: set = set()
        cur = a_head
        while cur:
            ancestors.add(cur)
            row = conn.execute(
                "SELECT parent_rev_id FROM world_revision WHERE rev_id=?",
                (cur,)
            ).fetchone()
            cur = row["parent_rev_id"] if row else None

        # Find first ancestor of B in A's ancestors
        cur = b_head
        while cur:
            if cur in ancestors:
                return cur
            row = conn.execute(
                "SELECT parent_rev_id FROM world_revision WHERE rev_id=?",
                (cur,)
            ).fetchone()
            cur = row["parent_rev_id"] if row else None

        return None


def create_plot_node(
    world_id: str,
    title: str,
    body: str | None = None,
) -> str:
    """Create a new plot node.

    Args:
        world_id: World this node belongs to
        title: Node title
        body: Optional node body/content

    Returns:
        Created node_id
    """
    with get_db() as conn:
        node_id = generate_uuid()
        now = now_ms()
        conn.execute(
            """INSERT INTO plot_node (
                node_id, world_id, title, body, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            (node_id, world_id, title, body, now, now)
        )
        return node_id


def create_plot_edge(
    world_id: str,
    from_node_id: str,
    to_node_id: str,
    kind: str | None = None,
) -> str:
    """Create a plot edge between nodes.

    Args:
        world_id: World this edge belongs to
        from_node_id: Source node
        to_node_id: Target node
        kind: Optional edge kind (e.g., 'choice', 'transition')

    Returns:
        Created edge_id

    Raises:
        ValueError: If either node doesn't exist
    """
    with get_db() as conn:
        # Verify both nodes exist
        from_node = conn.execute(
            "SELECT node_id FROM plot_node WHERE node_id=? AND world_id=?",
            (from_node_id, world_id)
        ).fetchone()
        to_node = conn.execute(
            "SELECT node_id FROM plot_node WHERE node_id=? AND world_id=?",
            (to_node_id, world_id)
        ).fetchone()

        if not from_node:
            raise ValueError(f"Source node not found: {from_node_id}")
        if not to_node:
            raise ValueError(f"Target node not found: {to_node_id}")

        edge_id = generate_uuid()
        now = now_ms()
        conn.execute(
            """INSERT INTO plot_edge (
                edge_id, world_id, from_node_id, to_node_id, kind, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (edge_id, world_id, from_node_id, to_node_id, kind, now, now)
        )
        return edge_id


def get_plot_node(node_id: str) -> dict[str, Any] | None:
    """Get a plot node by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM plot_node WHERE node_id=?",
            (node_id,)
        ).fetchone()
        return dict(row) if row else None


def get_plot_edges(world_id: str, node_id: str | None = None) -> list[dict[str, Any]]:
    """Get plot edges, optionally filtered by node."""
    with get_db() as conn:
        if node_id:
            rows = conn.execute(
                """SELECT * FROM plot_edge 
                   WHERE world_id=? AND (from_node_id=? OR to_node_id=?)
                   ORDER BY created_at_ms""",
                (world_id, node_id, node_id)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM plot_edge WHERE world_id=? ORDER BY created_at_ms",
                (world_id,)
            ).fetchall()
        return [dict(r) for r in rows]


def get_branch(branch_id: str) -> dict[str, Any] | None:
    """Get a branch by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM branch WHERE branch_id=?",
            (branch_id,)
        ).fetchone()
        return dict(row) if row else None


def list_branches(world_id: str, play_id: str | None = None) -> list[dict[str, Any]]:
    """List branches for a world, optionally filtered by playthrough."""
    with get_db() as conn:
        if play_id:
            rows = conn.execute(
                "SELECT * FROM branch WHERE world_id=? AND play_id=? ORDER BY created_at_ms",
                (world_id, play_id)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM branch WHERE world_id=? ORDER BY created_at_ms",
                (world_id,)
            ).fetchall()
        return [dict(r) for r in rows]
