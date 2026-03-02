#!/usr/bin/env python3
"""Character Card V2 import/export for RP assets."""

from __future__ import annotations

import logging
import json
from typing import Any

logger = logging.getLogger(__name__)

from canon.store import get_db, json_dumps, now_ms, generate_uuid


# Character Card V2 required fields
CARD_V2_FIELDS = {
    "name",
    "description",
    "personality",
    "scenario",
    "first_mes",
    "mes_example",
    "creator_notes",
    "system_prompt",
    "post_history_instructions",
    "tags",
    "creator",
    "character_version",
    "extensions",
}

CARD_V2_SPEC = "chara_card_v2"


def import_character_card_v2(data: dict) -> dict:
    """Import a Character Card V2 and store in database.
    
    Validates that spec == "chara_card_v2", then stores in both
    the character table and character_card_raw table.
    
    Args:
        data: Character Card V2 data dict
        
    Returns:
        Dict with character_id and card_id
        
    Raises:
        ValueError: If spec is not "chara_card_v2" or required fields missing
    """
    spec = data.get("spec")
    if spec != CARD_V2_SPEC:
        raise ValueError(f"Invalid spec: expected '{CARD_V2_SPEC}', got '{spec}'")
    
    # Extract required fields
    name = data.get("name")
    if not name:
        raise ValueError("Missing required field: name")
    
    description = data.get("description", "")
    personality = data.get("personality", "")
    scenario = data.get("scenario", "")
    first_mes = data.get("first_mes", "")
    mes_example = data.get("mes_example", "")
    creator_notes = data.get("creator_notes", "")
    system_prompt = data.get("system_prompt", "")
    post_history_instructions = data.get("post_history_instructions", "")
    tags = data.get("tags", [])
    creator = data.get("creator", "")
    character_version = data.get("character_version", "")
    extensions = data.get("extensions", {})
    
    # Get or create world_id (use default if not provided)
    world_id = data.get("world_id", "default")
    
    now = now_ms()
    character_id = generate_uuid()
    card_id = generate_uuid()
    
    with get_db() as conn:
        # Ensure world exists (foreign key requirement)
        conn.execute(
            """INSERT OR IGNORE INTO world (world_id, name, created_at_ms, updated_at_ms)
               VALUES (?, ?, ?, ?)""",
            (world_id, world_id, now, now),
        )
        
        # Insert into character table
    world_id = data.get("world_id", "default")
    
    now = now_ms()
    character_id = generate_uuid()
    card_id = generate_uuid()
    
    with get_db() as conn:
        # Insert into character table
        conn.execute(
            """INSERT INTO character 
               (character_id, world_id, name, canonical_description, created_at_ms, updated_at_ms)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (character_id, world_id, name, description, now, now),
        )
        
        # Build raw V2 card for storage
        raw_card = {
            "spec": CARD_V2_SPEC,
            "name": name,
            "description": description,
            "personality": personality,
            "scenario": scenario,
            "first_mes": first_mes,
            "mes_example": mes_example,
            "creator_notes": creator_notes,
            "system_prompt": system_prompt,
            "post_history_instructions": post_history_instructions,
            "tags": tags,
            "creator": creator,
            "character_version": character_version,
            "extensions": extensions,
        }
        
        # Insert into character_card_raw table
        conn.execute(
            """INSERT INTO character_card_raw
               (card_id, character_id, raw_json, created_at_ms)
               VALUES (?, ?, ?, ?)""",
            (card_id, character_id, json_dumps(raw_card), now),
        )
    
    return {
        "character_id": character_id,
        "card_id": card_id,
        "name": name,
    }


def export_character_card_v2(character_id: str) -> dict:
    """Reconstruct a Character Card V2 from database.
    
    Args:
        character_id: The character ID to export
        
    Returns:
        Character Card V2 dict
        
    Raises:
        KeyError: If character not found
    """
    with get_db() as conn:
        # Get character from character table
        char_row = conn.execute(
            "SELECT * FROM character WHERE character_id = ?",
            (character_id,),
        ).fetchone()
        
        if not char_row:
            raise KeyError(f"Character not found: {character_id}")
        
        # Get latest raw card from character_card_raw table
        raw_row = conn.execute(
            """SELECT raw_json FROM character_card_raw 
               WHERE character_id = ? 
               ORDER BY created_at_ms DESC LIMIT 1""",
            (character_id,),
        ).fetchone()
        
        if not raw_row:
            # Return basic card if no raw data
            return {
                "spec": CARD_V2_SPEC,
                "name": char_row["name"],
                "description": char_row["canonical_description"] or "",
                "personality": "",
                "scenario": "",
                "first_mes": "",
                "mes_example": "",
                "creator_notes": "",
                "system_prompt": "",
                "post_history_instructions": "",
                "tags": [],
                "creator": "",
                "character_version": "",
                "extensions": {},
            }
        
        raw_card = json.loads(raw_row["raw_json"])
        
        # Ensure spec is set
        raw_card["spec"] = CARD_V2_SPEC
        
        return raw_card


def update_character_and_raw(character_id: str, fields: dict) -> None:
    """Update both character table and raw_json for a character.
    
    This function syncs UI edits to both the character table
    (for basic fields) and the raw_json column (for full V2 card).
    
    Args:
        character_id: The character ID to update
        fields: Dict of fields to update (V2 card fields)
        
    Raises:
        KeyError: If character not found
    """
    with get_db() as conn:
        # Verify character exists
        char_row = conn.execute(
            "SELECT * FROM character WHERE character_id = ?",
            (character_id,),
        ).fetchone()
        
        if not char_row:
            raise KeyError(f"Character not found: {character_id}")
        
        now = now_ms()
        
        # Update character table with basic fields
        name = fields.get("name", char_row["name"])
        canonical_description = fields.get("description", char_row["canonical_description"])
        
        conn.execute(
            """UPDATE character 
               SET name = ?, canonical_description = ?, updated_at_ms = ?
               WHERE character_id = ?""",
            (name, canonical_description, now, character_id),
        )
        
        # Get existing raw card
        raw_row = conn.execute(
            """SELECT raw_json FROM character_card_raw 
               WHERE character_id = ? 
               ORDER BY created_at_ms DESC LIMIT 1""",
            (character_id,),
        ).fetchone()
        
        # Build updated raw card
        if raw_row:
            raw_card = json.loads(raw_row["raw_json"])
        else:
            raw_card = {"spec": CARD_V2_SPEC}
        
        # Update all V2 fields
        for field in CARD_V2_FIELDS:
            if field in fields:
                raw_card[field] = fields[field]
        
        # Ensure spec is set
        raw_card["spec"] = CARD_V2_SPEC
        
        # Insert new raw card entry
        card_id = generate_uuid()
        conn.execute(
            """INSERT INTO character_card_raw
               (card_id, character_id, raw_json, created_at_ms)
               VALUES (?, ?, ?, ?)""",
            (card_id, character_id, json_dumps(raw_card), now),
        )
