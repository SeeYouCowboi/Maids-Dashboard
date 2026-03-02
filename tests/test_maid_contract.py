"""Tests for maid_contract module."""

import pytest
from maid_contract import ParseError, parse_maid_commit


class TestParseMaidCommit:
    """Test cases for parse_maid_commit function."""
    
    def test_basic_maids_commit(self):
        """Test parsing a basic MAID_COMMIT with entities and facts."""
        raw = """MAID_COMMIT
---
entities_add:
  - type: person
    name: Alice
facts_add:
  - subject_name: Alice
    predicate: is
    object_value: wizard
    status: asserted
"""
        result = parse_maid_commit(raw)
        
        assert result["entities_add"] == [{"type": "person", "name": "Alice"}]
        assert result["facts_add"] == [{
            "subject_name": "Alice",
            "predicate": "is",
            "object_value": "wizard",
            "status": "asserted"
        }]
        assert result["facts_retire"] == []
        assert result["plot_move"] == {}
        assert result["notes"] == ""
    
    def test_empty_input(self):
        """Test that empty input raises ParseError."""
        with pytest.raises(ParseError, match="Empty input"):
            parse_maid_commit("")
    
    def test_missing_maid_commit_header(self):
        """Test that missing MAID_COMMIT header raises ParseError."""
        with pytest.raises(ParseError, match="must start with 'MAID_COMMIT'"):
            parse_maid_commit("some random text")
    
    def test_missing_separator(self):
        """Test that missing --- separator raises ParseError."""
        with pytest.raises(ParseError, match="Missing '---' separator"):
            parse_maid_commit("MAID_COMMIT\nentities_add:\n  - name: test")
    
    def test_empty_yaml_content(self):
        """Test that empty YAML content raises ParseError."""
        with pytest.raises(ParseError, match="No content"):
            parse_maid_commit("MAID_COMMIT\n---\n")
    
    def test_multiple_entities(self):
        """Test parsing multiple entities."""
        raw = """MAID_COMMIT
---
entities_add:
  - type: person
    name: Alice
  - type: person
    name: Bob
"""
        result = parse_maid_commit(raw)
        
        assert len(result["entities_add"]) == 2
        assert result["entities_add"][0]["name"] == "Alice"
        assert result["entities_add"][1]["name"] == "Bob"
    
    def test_facts_retire(self):
        """Test parsing facts_retire."""
        raw = """MAID_COMMIT
---
facts_retire:
  - subject_name: Alice
    predicate: is
    object_value: wizard
"""
        result = parse_maid_commit(raw)
        
        assert result["facts_retire"] == [{
            "subject_name": "Alice",
            "predicate": "is",
            "object_value": "wizard"
        }]
    
    def test_plot_move(self):
        """Test parsing plot_move."""
        raw = """MAID_COMMIT
---
plot_move:
  location: forest
  action: enters
"""
        result = parse_maid_commit(raw)
        
        assert result["plot_move"] == {
            "location": "forest",
            "action": "enters"
        }
    
    def test_notes(self):
        """Test parsing notes."""
        raw = """MAID_COMMIT
---
notes: This is a test note
"""
        result = parse_maid_commit(raw)
        
        assert result["notes"] == "This is a test note"
    
    def test_all_fields(self):
        """Test parsing all fields together."""
        raw = """MAID_COMMIT
---
entities_add:
  - type: person
    name: Alice
facts_add:
  - subject_name: Alice
    predicate: is
    object_value: wizard
    status: asserted
facts_retire:
  - subject_name: Bob
    predicate: is
    object_value: alive
plot_move:
  location: castle
  action: enters
notes: Testing all fields
"""
        result = parse_maid_commit(raw)
        
        assert len(result["entities_add"]) == 1
        assert len(result["facts_add"]) == 1
        assert len(result["facts_retire"]) == 1
        assert result["plot_move"]["location"] == "castle"
        assert result["notes"] == "Testing all fields"
    
    def test_preserves_default_values(self):
        """Test that missing fields get default empty values."""
        raw = """MAID_COMMIT
---
entities_add:
  - type: test
"""
        result = parse_maid_commit(raw)
        
        assert result["entities_add"] == [{"type": "test"}]
        assert result["facts_add"] == []
        assert result["facts_retire"] == []
        assert result["plot_move"] == {}
        assert result["notes"] == ""
    
    def test_with_leading_whitespace(self):
        """Test parsing with leading whitespace in raw input."""
        raw = """    MAID_COMMIT
    ---
    entities_add:
      - type: person
        name: Alice
"""
        result = parse_maid_commit(raw)
        
        assert result["entities_add"] == [{"type": "person", "name": "Alice"}]
    
    def test_boolean_values(self):
        """Test parsing boolean values."""
        raw = """MAID_COMMIT
---
entities_add:
  - type: thing
    active: true
    deleted: false
"""
        result = parse_maid_commit(raw)
        
        assert result["entities_add"][0]["active"] is True
        assert result["entities_add"][0]["deleted"] is False
    
    def test_numeric_values(self):
        """Test parsing numeric values."""
        raw = """MAID_COMMIT
---
entities_add:
  - type: thing
    count: 42
    price: 3.14
"""
        result = parse_maid_commit(raw)
        
        assert result["entities_add"][0]["count"] == 42
        assert result["entities_add"][0]["price"] == 3.14
