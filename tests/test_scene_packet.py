"""
Tests for scene_packet.py
"""

import pytest
from scene_packet import build_scene_packet, SECTION_BUDGET_RATIOS


class TestBuildScenePacket:
    """Test cases for build_scene_packet function."""
    
    def test_basic_output_structure(self):
        """Test basic packet output structure."""
        snapshot = {
            "world": "This is the world.",
            "invariants": "These are invariants.",
            "scene": "This is the scene.",
            "lore": "This is the lore."
        }
        lorebook_entries = []
        character_cards = []
        
        result = build_scene_packet(snapshot, lorebook_entries, character_cards)
        
        assert "[WORLD]" in result
        assert "[INVARIANTS]" in result
        assert "[SCENE]" in result
        assert "[LORE]" in result
        assert "[PACKET_STATS:" in result
    
    def test_invariants_never_truncated(self):
        """Test that INVARIANTS section is never truncated."""
        long_invariants = "X" * 10000  # Very long invariants
        snapshot = {
            "world": "World content.",
            "invariants": long_invariants,
            "scene": "Scene content.",
            "lore": "Lore content."
        }
        
        result = build_scene_packet(snapshot, [], [], max_tokens=500)
        
        # INVARIANTS should contain full content
        assert long_invariants in result
    
    def test_lore_truncation_first(self):
        """Test that LORE is truncated first when over budget."""
        # Create enough content to exceed budget
        long_lore = "L" * 5000
        snapshot = {
            "world": "W" * 100,
            "invariants": "I" * 100,
            "scene": "S" * 100,
            "lore": long_lore
        }
        
        result = build_scene_packet(snapshot, [], [], max_tokens=500)
        
        # LORE should be truncated
        assert "[LORE]" in result
        # Should indicate dropped lore
        assert "lore_dropped=" in result
    
    def test_lorebook_entries_included(self):
        """Test that matched lorebook entries are included."""
        snapshot = {
            "world": "",
            "invariants": "",
            "scene": "",
            "lore": ""
        }
        lorebook_entries = [
            {"content": "Lorebook entry 1"},
            {"content": "Lorebook entry 2"}
        ]
        
        result = build_scene_packet(snapshot, lorebook_entries, [])
        
        assert "Lorebook entry 1" in result
        assert "Lorebook entry 2" in result
    
    def test_character_cards_included(self):
        """Test that character cards are included."""
        snapshot = {
            "world": "",
            "invariants": "",
            "scene": "",
            "lore": ""
        }
        character_cards = [
            {
                "name": "Hero",
                "personality": "Brave",
                "description": "A brave hero",
                "scenario": "On a quest"
            }
        ]
        
        result = build_scene_packet(snapshot, [], character_cards)
        
        assert "[CHARACTER_RULES]" in result
        assert "Hero" in result
        assert "Brave" in result
    
    def test_section_order(self):
        """Test that sections appear in correct order."""
        snapshot = {
            "world": "World",
            "invariants": "Invariants",
            "scene": "Scene",
            "lore": "Lore"
        }
        
        result = build_scene_packet(snapshot, [], [])
        
        world_pos = result.find("[WORLD]")
        invar_pos = result.find("[INVARIANTS]")
        scene_pos = result.find("[SCENE]")
        lore_pos = result.find("[LORE]")
        stats_pos = result.find("[PACKET_STATS:")
        
        assert world_pos < invar_pos < scene_pos < lore_pos < stats_pos
    
    def test_packet_stats_format(self):
        """Test PACKET_STATS format."""
        snapshot = {
            "world": "Test world",
            "invariants": "Test invariants",
            "scene": "Test scene",
            "lore": "Test lore"
        }
        
        result = build_scene_packet(snapshot, [], [])
        
        assert "tokens_estimated=" in result
        assert "lore_dropped=" in result
    
    def test_cjk_token_estimation(self):
        """Test that CJK characters are estimated correctly."""
        snapshot = {
            "world": "中" * 100,  # 100 CJK chars = ~50 tokens
            "invariants": "",
            "scene": "",
            "lore": ""
        }
        
        result = build_scene_packet(snapshot, [], [], max_tokens=1000)
        
        # Should include the CJK content
        assert "中" in result
    
    def test_mixed_cjk_ascii_estimation(self):
        """Test mixed CJK and ASCII token estimation."""
        snapshot = {
            "world": "A" * 100 + "中" * 100,  # ~25 + 50 = ~75 tokens
            "invariants": "",
            "scene": "",
            "lore": ""
        }
        
        result = build_scene_packet(snapshot, [], [], max_tokens=1000)
        
        assert "A" in result
    
    def test_empty_snapshot(self):
        """Test with empty snapshot."""
        snapshot = {
            "world": "",
            "invariants": "",
            "scene": "",
            "lore": ""
        }
        
        result = build_scene_packet(snapshot, [], [])
        
        # Should still have stats
        assert "[PACKET_STATS:" in result
    
    def test_section_budget_ratios_sum(self):
        """Test that budget ratios sum to 1.0."""
        total = sum(SECTION_BUDGET_RATIOS.values())
        assert total == 1.0
    
    def test_budget_ratios_values(self):
        """Test specific budget ratio values."""
        assert SECTION_BUDGET_RATIOS["INVARIANTS"] == 0.15
        assert SECTION_BUDGET_RATIOS["WORLD_FACTS"] == 0.25
        assert SECTION_BUDGET_RATIOS["SCENE"] == 0.15
        assert SECTION_BUDGET_RATIOS["LORE"] == 0.30
        assert SECTION_BUDGET_RATIOS["CHARACTER_RULES"] == 0.15
    
    def test_lore_entry_dropping(self):
        """Test that lore entries are dropped before base lore."""
        snapshot = {
            "world": "",
            "invariants": "",
            "scene": "",
            "lore": "Base lore content."
        }
        lorebook_entries = [
            {"content": "Entry 1" * 100},
            {"content": "Entry 2" * 100},
            {"content": "Entry 3" * 100}
        ]
        
        # Very small max_tokens to force dropping
        result = build_scene_packet(snapshot, lorebook_entries, [], max_tokens=100)
        
        # Should have lore_dropped > 0
        assert "lore_dropped=" in result
    
    def test_world_section(self):
        """Test WORLD section is populated."""
        snapshot = {
            "world": "The kingdom of Eldoria is ancient.",
            "invariants": "",
            "scene": "",
            "lore": ""
        }
        
        result = build_scene_packet(snapshot, [], [])
        
        assert "The kingdom of Eldoria is ancient" in result
    
    def test_scene_section(self):
        """Test SCENE section is populated."""
        snapshot = {
            "world": "",
            "invariants": "",
            "scene": "The hero stands at the crossroads.",
            "lore": ""
        }
        
        result = build_scene_packet(snapshot, [], [])
        
        assert "The hero stands at the crossroads" in result
    
    def test_multiple_character_cards(self):
        """Test multiple character cards."""
        snapshot = {"world": "", "invariants": "", "scene": "", "lore": ""}
        character_cards = [
            {"name": "Alice", "personality": "Kind"},
            {"name": "Bob", "personality": "Brave"}
        ]
        
        result = build_scene_packet(snapshot, [], character_cards)
        
        assert "Alice" in result
        assert "Bob" in result
        assert "Kind" in result
        assert "Brave" in result
    
    def test_character_card_missing_fields(self):
        """Test character card with missing fields."""
        snapshot = {"world": "", "invariants": "", "scene": "", "lore": ""}
        character_cards = [
            {"name": "Solo"}  # Only name, no other fields
        ]
        
        result = build_scene_packet(snapshot, [], character_cards)
        
        assert "Solo" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
