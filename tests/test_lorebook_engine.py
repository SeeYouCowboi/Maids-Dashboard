"""
Tests for lorebook_engine.py
"""

import pytest
from lorebook_engine import match_lorebook_entries


class TestMatchLorebookEntries:
    """Test cases for match_lorebook_entries function."""
    
    def test_keyword_match(self):
        """Test basic keyword matching."""
        messages = [{"content": "The wizard cast a fire spell in the ancient tower."}]
        entries = [
            {
                "id": "magic_lore",
                "triggers": ["wizard", "spell"],
                "content": "Magic users draw power from the ley lines.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        assert len(result) == 1
        assert result[0]["id"] == "magic_lore"
        assert "wizard" in result[0]["why_fired"] or "spell" in result[0]["why_fired"]
    
    def test_regex_match(self):
        """Test regex pattern matching."""
        messages = [{"content": "The dragon has 500 HP and breathes fire."}]
        entries = [
            {
                "id": "dragon_stats",
                "triggers": [r"\bdragon\b", r"\d+ HP"],
                "content": "Dragons are ancient creatures with powerful breath weapons.",
                "priority": 1,
                "match_type": "regex",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        assert len(result) == 1
        assert result[0]["id"] == "dragon_stats"
    
    def test_case_insensitive(self):
        """Test case-insensitive matching."""
        messages = [{"content": "The MAGE cast a powerful SPELL."}]
        entries = [
            {
                "id": "mage_entry",
                "triggers": ["mage", "spell"],
                "content": "Mages are magical practitioners.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        assert len(result) == 1
        assert result[0]["id"] == "mage_entry"
    
    def test_and_logic(self):
        """Test AND logic with multiple triggers."""
        messages = [{"content": "The knight wielded a sword and shield."}]
        entries = [
            {
                "id": "knight_entry",
                "triggers": ["knight sword shield"],
                "content": "Knights are heavily armored warriors.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        assert len(result) == 1
        assert result[0]["id"] == "knight_entry"
    
    def test_not_logic(self):
        """Test NOT logic to exclude matches."""
        messages = [{"content": "The dark wizard cast an evil spell."}]
        entries = [
            {
                "id": "good_magic",
                "triggers": ["wizard !dark !evil"],
                "content": "Good magic comes from light.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        # Should NOT match because "dark" and "evil" are in NOT patterns
        assert len(result) == 0
    
    def test_not_prevents_match(self):
        """Test that NOT pattern prevents a match."""
        messages = [{"content": "The fire dragon attacked the village."}]
        entries = [
            {
                "id": "water_dragon",
                "triggers": ["dragon !fire"],
                "content": "Water dragons are peaceful creatures.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        # Should NOT match because "fire" triggers the NOT
        assert len(result) == 0
    
    def test_priority_sorting(self):
        """Test that results are sorted by priority."""
        messages = [{"content": "The elf and dwarf walked together."}]
        entries = [
            {
                "id": "dwarf",
                "triggers": ["dwarf"],
                "content": "Dwarves are stout craftsmen.",
                "priority": 5,
                "match_type": "keyword",
                "insert_at": "start"
            },
            {
                "id": "elf",
                "triggers": ["elf"],
                "content": "Elves are graceful and long-lived.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        assert len(result) == 2
        assert result[0]["id"] == "elf"
        assert result[1]["id"] == "dwarf"
    
    def test_insertion_order_sorting(self):
        """Test stable sort by insertion order when priorities equal."""
        messages = [{"content": "There is a sword and a shield here."}]
        entries = [
            {
                "id": "sword",
                "triggers": ["sword"],
                "content": "Swords are sharp weapons.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            },
            {
                "id": "shield",
                "triggers": ["shield"],
                "content": "Shields are defensive gear.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        assert len(result) == 2
        # Both have priority 1, sorted alphabetically by entry_id: shield < sword
        assert result[0]["id"] == "shield"
        assert result[1]["id"] == "sword"
    
    def test_entry_id_sorting(self):
        """Test stable sort by entry_id when priorities and insertion order equal."""
        messages = [{"content": "Magic is everywhere."}]
        entries = [
            {
                "id": "zebra",
                "triggers": ["magic"],
                "content": "Zebra entry.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            },
            {
                "id": "alpha",
                "triggers": ["magic"],
                "content": "Alpha entry.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        assert len(result) == 2
        assert result[0]["id"] == "alpha"
        assert result[1]["id"] == "zebra"
    
    def test_token_budget_trimming(self):
        """Test that entries are trimmed to fit token budget."""
        messages = [{"content": "magic spell wizard"}]
        
        # Two entries that together exceed budget
        long_content = "A" * 500  # ~125 tokens
        entries = [
            {
                "id": "entry1",
                "triggers": ["magic"],
                "content": long_content,
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            },
            {
                "id": "entry2",
                "triggers": ["spell"],
                "content": long_content,
                "priority": 2,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 200)
        
        # Only first entry should fit
        assert len(result) == 1
        assert result[0]["id"] == "entry1"
    
    def test_scan_depth_limit(self):
        """Test that only recent messages are scanned."""
        messages = [
            {"content": "Old content about dragons."},
            {"content": "New content about wizards."}
        ]
        entries = [
            {
                "id": "dragon_entry",
                "triggers": ["dragon"],
                "content": "Dragons are ancient.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            },
            {
                "id": "wizard_entry",
                "triggers": ["wizard"],
                "content": "Wizards are magical.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        # Only scan last 1 message
        result = match_lorebook_entries(messages, entries, 1, 1000)
        
        assert len(result) == 1
        assert result[0]["id"] == "wizard_entry"
    
    def test_no_match_returns_empty(self):
        """Test that no matches returns empty list."""
        messages = [{"content": "Just a normal day."}]
        entries = [
            {
                "id": "magic_entry",
                "triggers": ["wizard", "dragon"],
                "content": "Magic content.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        assert result == []
    
    def test_why_fired_metadata(self):
        """Test that why_fired contains trigger info."""
        messages = [{"content": "The fire dragon breathes fire."}]
        entries = [
            {
                "id": "test_entry",
                "triggers": ["dragon", "fire"],
                "content": "Test content.",
                "priority": 1,
                "match_type": "keyword",
                "insert_at": "start"
            }
        ]
        
        result = match_lorebook_entries(messages, entries, 5, 1000)
        
        assert len(result) == 1
        assert "why_fired" in result[0]
        assert "dragon" in result[0]["why_fired"] or "fire" in result[0]["why_fired"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
