"""
Scene Packet Builder - Builds context packets from snapshots and lorebook entries.
"""
import logging

import math
from typing import Any

logger = logging.getLogger(__name__)

from core.text_util import estimate_tokens, is_cjk
from core.text_util import estimate_tokens, is_cjk

# Fixed section budget ratios
SECTION_BUDGET_RATIOS = {
    "INVARIANTS": 0.15,
    "WORLD_FACTS": 0.25,
    "SCENE": 0.15,
    "LORE": 0.30,
    "CHARACTER_RULES": 0.15
}

# scene_packet applies a 10% safety margin to all token estimates
_SAFETY_MARGIN = 0.1


def _estimate_tokens(text: str) -> int:
    """Estimate token count for text with 10% safety margin."""
    return estimate_tokens(text, safety_margin=_SAFETY_MARGIN)


def _is_cjk(char: str) -> bool:
    """Check if character is CJK."""
    return is_cjk(char)


def build_scene_packet(
    snapshot: dict,
    lorebook_entries: list,
    character_cards: list,
    max_tokens: int = 2048
) -> str:
    """
    Build a scene packet from snapshot, lorebook entries, and character cards.
    
    Args:
        snapshot: Dict with keys 'world', 'invariants', 'scene', 'lore'
        lorebook_entries: List of matched lorebook entries
        character_cards: List of character card dicts
        max_tokens: Maximum tokens for the packet
    
    Returns:
        Formatted scene packet string with sections and stats
    """
    # Calculate section budgets
    section_budgets = {
        section: int(max_tokens * ratio)
        for section, ratio in SECTION_BUDGET_RATIOS.items()
    }
    
    # Build each section
    sections = {}
    
    # WORLD section
    world_content = snapshot.get("world", "")
    sections["WORLD"] = _apply_budget(world_content, section_budgets["WORLD_FACTS"])
    
    # INVARIANTS section (never truncated)
    invariants_content = snapshot.get("invariants", "")
    sections["INVARIANTS"] = invariants_content
    
    # SCENE section
    scene_content = snapshot.get("scene", "")
    sections["SCENE"] = _apply_budget(scene_content, section_budgets["SCENE"])
    
    # LORE section - with truncation logic (LORE truncates first)
    lore_entries_content = snapshot.get("lore", "")
    lore_from_entries = "\n\n---\n\n".join(
        entry.get("content", "") for entry in lorebook_entries
    )
    combined_lore = lore_entries_content + ("\n\n---\n\n" + lore_from_entries if lore_from_entries else "")
    
    lore_budget = section_budgets["LORE"]
    sections["LORE"], lore_dropped = _truncate_lore(combined_lore, lore_budget, lore_from_entries)
    
    # CHARACTER_RULES section
    char_rules = _build_character_rules(character_cards)
    sections["CHARACTER_RULES"] = _apply_budget(char_rules, section_budgets["CHARACTER_RULES"])
    
    # Calculate total estimated tokens
    total_tokens = sum(_estimate_tokens(content) for content in sections.values())
    # Apply 10% safety margin
    total_tokens = int(total_tokens * 1.1)
    
    # Build output string
    output_parts = []
    
    if sections["WORLD"]:
        output_parts.append(f"[WORLD]\n{sections['WORLD']}")
    
    if sections["INVARIANTS"]:
        output_parts.append(f"[INVARIANTS]\n{sections['INVARIANTS']}")
    
    if sections["SCENE"]:
        output_parts.append(f"[SCENE]\n{sections['SCENE']}")
    
    if sections["LORE"]:
        output_parts.append(f"[LORE]\n{sections['LORE']}")
    
    if sections["CHARACTER_RULES"]:
        output_parts.append(f"[CHARACTER_RULES]\n{sections['CHARACTER_RULES']}")
    
    # Append stats
    output_parts.append(f"[PACKET_STATS: tokens_estimated={total_tokens}, lore_dropped={lore_dropped}]")
    
    return "\n\n".join(output_parts)


def _apply_budget(text: str, budget: int) -> str:
    """Apply token budget to text by truncating if necessary."""
    if not text:
        return ""
    
    estimated = _estimate_tokens(text)
    if estimated <= budget:
        return text
    
    # Binary search for appropriate length
    low, high = 0, len(text)
    
    while low < high:
        mid = (low + high + 1) // 2
        if _estimate_tokens(text[:mid]) <= budget:
            low = mid
        else:
            high = mid - 1
    
    return text[:low]


def _truncate_lore(combined_lore: str, budget: int, lore_from_entries: str) -> tuple:
    """
    Truncate lore section, dropping from entries first.
    
    Returns:
        Tuple of (truncated_lore, number_dropped)
    """
    if not combined_lore:
        return "", 0
    
    estimated = _estimate_tokens(combined_lore)
    if estimated <= budget:
        return combined_lore, 0
    
    # If there are entries to drop from, drop them first
    if lore_from_entries:
        # Count how many entries we have
        entry_parts = lore_from_entries.split("\n\n---\n\n")
        num_entries = len(entry_parts)
        
        # Try dropping entries one by one
        dropped = 0
        base_lore = combined_lore.replace(lore_from_entries, "").strip()
        if base_lore:
            base_lore = base_lore.rstrip("\n\n---\n\n").rstrip("\n\n")
        
        for i in range(num_entries, 0, -1):
            test_lore = base_lore
            if i > 0:
                kept_entries = "\n\n---\n\n".join(entry_parts[:i])
                if test_lore and kept_entries:
                    test_lore = test_lore + "\n\n---\n\n" + kept_entries
                elif kept_entries:
                    test_lore = kept_entries
            
            if _estimate_tokens(test_lore) <= budget:
                return test_lore, num_entries - i
        
        # If still over budget, truncate base lore
        return _apply_budget(base_lore, budget), num_entries
    
    # No entries to drop, just truncate
    return _apply_budget(combined_lore, budget), 0


def _build_character_rules(character_cards: list) -> str:
    """Build character rules from character cards."""
    if not character_cards:
        return ""
    
    rules_parts = []
    for card in character_cards:
        name = card.get("name", "Unknown")
        personality = card.get("personality", "")
        description = card.get("description", "")
        scenario = card.get("scenario", "")
        
        parts = [f"## {name}"]
        if personality:
            parts.append(f"Personality: {personality}")
        if description:
            parts.append(f"Description: {description}")
        if scenario:
            parts.append(f"Scenario: {scenario}")
        
        rules_parts.append("\n".join(parts))
    
    return "\n\n".join(rules_parts)
