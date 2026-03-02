"""
Lorebook Engine - Matches lorebook entries against messages.
"""
import logging

import re
from typing import Any

logger = logging.getLogger(__name__)

from core.text_util import estimate_tokens as _estimate_tokens
from core.text_util import estimate_tokens as _estimate_tokens
from core.text_util import is_cjk as _is_cjk


def match_lorebook_entries(
    messages: list[dict[str, Any]],
    lorebook_entries: list[dict[str, Any]],
    scan_depth: int,
    token_budget: int
) -> list[dict[str, Any]]:
    """
    Match lorebook entries against recent messages.
    
    Args:
        messages: List of message dicts with 'content' key
        lorebook_entries: List of lorebook entry dicts with keys:
            - id: unique identifier
            - triggers: list of trigger strings (keyword or regex patterns)
            - content: the lore entry content
            - priority: integer for sorting
            - match_type: 'keyword' or 'regex'
            - insert_at: 'start' or 'end'
        scan_depth: Number of recent messages to scan
        token_budget: Maximum tokens allowed for matched entries
    
    Returns:
    """
    # Get messages to scan (last scan_depth messages)
    messages_to_scan = messages[-scan_depth:] if scan_depth > 0 else []
    
    # Combine all content from scanned messages
    combined_content = " ".join(
        msg.get("content", "") for msg in messages_to_scan
    ).lower()
    
    matched_entries = []

    for idx, entry in enumerate(lorebook_entries):
        entry_id = entry.get("id", "")
        triggers = entry.get("triggers", [])
        match_type = entry.get("match_type", "keyword")
        
        if not triggers:
            continue
        
        # Check if any trigger matches
        triggered = False
        matched_triggers = []
        best_pos = None
        
        for trigger in triggers:
            # Check for NOT patterns (prefixed with !)
            not_patterns = []
            positive_triggers = []
            
            if isinstance(trigger, str):
                # Handle AND/NOT sets in trigger string
                parts = trigger.split()
                for part in parts:
                    if part.startswith("!"):
                        not_patterns.append(part[1:])
                    else:
                        positive_triggers.append(part)
                
                # Check NOT patterns first - if any match, entry doesn't fire
                for not_pat in not_patterns:
                    if _matches_pattern(not_pat, combined_content, "keyword"):
                        triggered = False
                        break
                else:
                    # If no NOT patterns matched, check positive triggers
                    if positive_triggers:
                        # AND logic: all positive triggers must match
                        positions = [_match_pos(pt, combined_content, match_type) for pt in positive_triggers]
                        all_positive_match = all(p is not None for p in positions)
                        if all_positive_match:
                            triggered = True
                            matched_triggers.extend(positive_triggers)
                            pos = min(p for p in positions if p is not None)
                            best_pos = pos if best_pos is None else min(best_pos, pos)
                    else:
                        # No positive triggers, just NOT check passed
                        triggered = True
            else:
                # Simple trigger (non-AND/NOT)
                pos = _match_pos(trigger, combined_content, match_type)
                if pos is not None:
                    triggered = True
                    matched_triggers.append(trigger)
                    best_pos = pos if best_pos is None else min(best_pos, pos)
        
        if triggered:
            matched_entries.append({
                "id": entry_id,
                "content": entry.get("content", ""),
                "priority": entry.get("priority", 0),
                "insert_at": entry.get("insert_at", "start"),
                "insertion_order": (best_pos if best_pos is not None else idx),
                "why_fired": f"matched: {', '.join(matched_triggers) if matched_triggers else 'trigger'}"
            })
    
    # Sort by priority asc, then entry_id asc (for deterministic ordering)
    matched_entries.sort(key=lambda x: (x["priority"], x.get("id", "")))
    # Calculate total tokens and trim if needed
    result = []
    total_tokens = 0
    
    for entry in matched_entries:
        entry_tokens = _estimate_tokens(entry["content"])
        if total_tokens + entry_tokens <= token_budget:
            result.append(entry)
            total_tokens += entry_tokens
    
    return result


def _matches_pattern(pattern: str, content: str, match_type: str) -> bool:
    """Check if a pattern matches the content."""
    if match_type == "regex":
        try:
            return bool(re.search(pattern, content, re.IGNORECASE))
        except re.error:
            # Invalid regex, fall back to keyword match
            return pattern.lower() in content
    else:
        # Keyword match (case-insensitive)
        return pattern.lower() in content


def _match_pos(pattern: str, content: str, match_type: str) -> int | None:
    if not isinstance(pattern, str) or not pattern:
        return None
    if match_type == "regex":
        try:
            m = re.search(pattern, content, re.IGNORECASE)
            return m.start() if m else None
        except re.error:
            return content.find(pattern.lower()) if pattern.lower() in content else None
    pos = content.find(pattern.lower())
    return pos if pos >= 0 else None

