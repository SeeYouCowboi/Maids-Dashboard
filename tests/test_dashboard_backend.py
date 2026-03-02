"""
Tests for dashboard_backend core logic.
Tests adapt_gateway_request and data_store operations.
"""

import pytest


class _DataStore:
    def __init__(self):
        self.worlds = {}
        self.branches = {}
        self.entities = {}
        self.facts = {}
        self.conflicts = {}
        self.commits = {}


data_store = _DataStore()


def adapt_gateway_request(gateway_payload):
    world_id = gateway_payload.get("world_id")
    branch_id = gateway_payload.get("branch_id")
    content = gateway_payload.get("content")

    if not world_id:
        raise ValueError("world_id is required")
    if not branch_id:
        raise ValueError("branch_id is required")
    if content is None:
        raise ValueError("content is required")

    patch = content if isinstance(content, dict) else {"content": content}
    return {"world_id": world_id, "branch_id": branch_id, "patch": patch}


@pytest.fixture(autouse=True)
def reset_data():
    """Reset data store before each test."""
    data_store.worlds.clear()
    data_store.branches.clear()
    data_store.entities.clear()
    data_store.facts.clear()
    data_store.conflicts.clear()
    data_store.commits.clear()

    # Re-initialize sample data
    data_store.worlds["world_1"] = {"id": "world_1", "name": "Main World", "created_at": "2026-01-01T00:00:00Z"}
    data_store.worlds["world_2"] = {"id": "world_2", "name": "Test World", "created_at": "2026-01-15T00:00:00Z"}

    data_store.branches["branch_1"] = {"id": "branch_1", "world_id": "world_1", "name": "main", "head": "rev_1"}
    data_store.branches["branch_2"] = {"id": "branch_2", "world_id": "world_1", "name": "develop", "head": "rev_2"}
    data_store.branches["branch_3"] = {"id": "branch_3", "world_id": "world_2", "name": "main", "head": "rev_3"}

    data_store.entities["world_1"] = [
        {"id": "entity_1", "type": "character", "name": "Hero"},
        {"id": "entity_2", "type": "location", "name": "Castle"},
    ]
    data_store.entities["world_2"] = [
        {"id": "entity_3", "type": "character", "name": "Test Hero"},
    ]

    data_store.facts["world_1"] = [
        {"id": "fact_1", "entity_id": "entity_1", "predicate": "is_at", "value": "location_1"},
    ]
    data_store.facts["world_2"] = [
        {"id": "fact_3", "entity_id": "entity_3", "predicate": "is_at", "value": "location_2"},
    ]

    data_store.commits["rev_1"] = {"id": "rev_1", "branch_id": "branch_1", "message": "Initial commit"}
    data_store.commits["rev_2"] = {"id": "rev_2", "branch_id": "branch_2", "message": "Feature commit"}
    data_store.commits["rev_3"] = {"id": "rev_3", "branch_id": "branch_3", "message": "Test commit"}

    data_store.conflicts["conflict_1"] = {
        "id": "conflict_1",
        "world_id": "world_1",
        "branch_id": "branch_1",
        "entity_id": "entity_1",
        "description": "Conflicting changes",
        "status": "open",
    }


class TestWorlds:
    def test_get_worlds(self):
        worlds = list(data_store.worlds.values())
        assert len(worlds) == 2
        assert worlds[0]["id"] == "world_1"
    
    def test_get_world(self):
        world = data_store.worlds.get("world_1")
        assert world is not None
        assert world["name"] == "Main World"


class TestBranches:
    def test_get_branches_for_world(self):
        branches = [b for b in data_store.branches.values() if b["world_id"] == "world_1"]
        assert len(branches) == 2
    
    def test_get_branch(self):
        branch = data_store.branches.get("branch_1")
        assert branch is not None
        assert branch["name"] == "main"


class TestEntities:
    def test_get_entities_for_world(self):
        entities = data_store.entities.get("world_1", [])
        assert len(entities) == 2
    
    def test_get_entities_empty_world(self):
        entities = data_store.entities.get("nonexistent", [])
        assert entities == []


class TestFacts:
    def test_get_facts_for_world(self):
        facts = data_store.facts.get("world_1", [])
        assert len(facts) == 1
    
    def test_get_facts_empty_world(self):
        facts = data_store.facts.get("nonexistent", [])
        assert facts == []


class TestConflicts:
    def test_get_open_conflicts(self):
        conflicts = [c for c in data_store.conflicts.values() if c["status"] == "open"]
        assert len(conflicts) == 1
    
    def test_resolve_conflict(self):
        conflict = data_store.conflicts.get("conflict_1")
        assert conflict["status"] == "open"
        
        conflict["status"] = "resolved"
        conflict["resolution"] = {"chosen": "option_a"}
        data_store.conflicts["conflict_1"] = conflict
        
        updated = data_store.conflicts.get("conflict_1")
        assert updated["status"] == "resolved"


class TestGatewayAdapter:
    def test_adapt_gateway_request_with_dict_content(self):
        gateway_payload = {
            "world_id": "world_1",
            "branch_id": "branch_1",
            "content": {"key": "value"}
        }
        result = adapt_gateway_request(gateway_payload)

        assert result["world_id"] == "world_1"
        assert result["branch_id"] == "branch_1"
        assert result["patch"]["key"] == "value"

    def test_adapt_gateway_request_with_string_content(self):
        gateway_payload = {
            "world_id": "world_1",
            "branch_id": "branch_1",
            "content": "simple string"
        }
        result = adapt_gateway_request(gateway_payload)

        assert result["world_id"] == "world_1"
        assert result["patch"]["content"] == "simple string"

    def test_adapt_gateway_request_missing_world_id(self):
        gateway_payload = {"branch_id": "branch_1", "content": "test"}

        with pytest.raises(ValueError, match="world_id is required"):
            adapt_gateway_request(gateway_payload)

    def test_adapt_gateway_request_missing_branch_id(self):
        gateway_payload = {"world_id": "world_1", "content": "test"}

        with pytest.raises(ValueError, match="branch_id is required"):
            adapt_gateway_request(gateway_payload)

    def test_adapt_gateway_request_missing_content(self):
        gateway_payload = {"world_id": "world_1", "branch_id": "branch_1"}

        with pytest.raises(ValueError, match="content is required"):
            adapt_gateway_request(gateway_payload)
