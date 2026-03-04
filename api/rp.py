"""RP API Router — Lorebook, Characters, Rooms, Messages.

All data stored in dashboard.db (standalone, no OpenClaw dependency).
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from lorebook_engine import match_lorebook_entries
from services.state import get_db
from sse_manager import SSEManager
from services.state import get_sse

router = APIRouter(prefix="/api/v1/rp", tags=["rp"])


def _now_ms() -> int:
    return int(time.time() * 1000)


def _gen_id() -> str:
    return str(uuid.uuid4())


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def _json_loads(s: str | None, default: Any = None) -> Any:
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:
        return default


def _broadcast(event_type: str, data: dict[str, Any]) -> None:
    sse_mgr = get_sse()
    if sse_mgr is None:
        return
    try:
        sse_mgr.broadcast("message", {"type": event_type, **data})
    except Exception:
        pass


@router.get("/lorebook")
def list_lore(request: Request) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    world_id = request.query_params.get("world_id", "default")
    q = request.query_params.get("q", "").strip().lower()
    with db.get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM rp_lore_entry WHERE world_id=? ORDER BY priority ASC, title ASC",
            (world_id,),
        ).fetchall()
    entries = []
    for row in rows:
        entry = dict(row)
        entry["tags"] = _json_loads(entry.pop("tags_json", "[]"), [])
        entry["triggers"] = _json_loads(entry.pop("triggers_json", "[]"), [])
        entries.append(entry)
    if q:
        entries = [
            e
            for e in entries
            if q in e["title"].lower() or q in (e["body"] or "").lower()
        ]
    return {"entries": entries}


@router.post("/lorebook")
def create_lore(payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    world_id = str(payload.get("world_id") or "default")
    title = str(payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail={"error": "title is required"})
    body = str(payload.get("body") or "")
    tags = payload.get("tags", [])
    triggers = payload.get("triggers", [])
    match_type = str(payload.get("match_type") or "keyword")
    priority = int(payload.get("priority") or 0)
    insert_at = str(payload.get("insert_at") or "start")
    enabled = int(bool(payload.get("enabled", True)))
    entry_id = _gen_id()
    now = _now_ms()
    with db.get_connection() as conn:
        conn.execute(
            """INSERT INTO rp_lore_entry
               (id, world_id, title, body, tags_json, triggers_json, match_type, priority, insert_at, enabled, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                entry_id,
                world_id,
                title,
                body,
                _json_dumps(tags),
                _json_dumps(triggers),
                match_type,
                priority,
                insert_at,
                enabled,
                now,
                now,
            ),
        )
        conn.commit()
    entry = {
        "id": entry_id,
        "world_id": world_id,
        "title": title,
        "body": body,
        "tags": tags,
        "triggers": triggers,
        "match_type": match_type,
        "priority": priority,
        "insert_at": insert_at,
        "enabled": bool(enabled),
        "created_at": now,
        "updated_at": now,
    }
    _broadcast("lore_created", {"entry": entry})
    return {"entry": entry}


@router.put("/lorebook/{entry_id}")
def update_lore(entry_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    with db.get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM rp_lore_entry WHERE id=?", (entry_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"error": "Entry not found"})
        now = _now_ms()
        title = str(payload.get("title") or row["title"])
        body = str(payload.get("body") if "body" in payload else row["body"] or "")
        tags = payload.get("tags", _json_loads(row["tags_json"], []))
        triggers = payload.get("triggers", _json_loads(row["triggers_json"], []))
        match_type = str(payload.get("match_type") or row["match_type"])
        priority = int(
            payload.get("priority") if "priority" in payload else row["priority"]
        )
        insert_at = str(payload.get("insert_at") or row["insert_at"])
        enabled = int(bool(payload.get("enabled", bool(row["enabled"]))))
        conn.execute(
            """UPDATE rp_lore_entry
               SET title=?, body=?, tags_json=?, triggers_json=?, match_type=?, priority=?, insert_at=?, enabled=?, updated_at=?
               WHERE id=?""",
            (
                title,
                body,
                _json_dumps(tags),
                _json_dumps(triggers),
                match_type,
                priority,
                insert_at,
                enabled,
                now,
                entry_id,
            ),
        )
        conn.commit()
    return {
        "entry": {
            "id": entry_id,
            "title": title,
            "body": body,
            "tags": tags,
            "triggers": triggers,
            "match_type": match_type,
            "priority": priority,
            "insert_at": insert_at,
            "enabled": bool(enabled),
            "updated_at": now,
        }
    }


@router.delete("/lorebook/{entry_id}")
def delete_lore(entry_id: str) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    with db.get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM rp_lore_entry WHERE id=?", (entry_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"error": "Entry not found"})
        conn.execute("DELETE FROM rp_lore_entry WHERE id=?", (entry_id,))
        conn.commit()
    return {"ok": True, "deleted_id": entry_id}


@router.post("/lorebook/match_preview")
def match_preview(payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    world_id = str(payload.get("world_id") or "default")
    message = str(payload.get("message") or "")
    scan_depth = int(payload.get("scan_depth") or 10)
    token_budget = int(payload.get("token_budget") or 2048)
    with db.get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM rp_lore_entry WHERE world_id=? AND enabled=1",
            (world_id,),
        ).fetchall()
    lorebook_entries = []
    for row in rows:
        entry = dict(row)
        triggers = _json_loads(entry.get("triggers_json", "[]"), [])
        if not triggers:
            triggers = [entry["title"].lower()]
        lorebook_entries.append(
            {
                "id": entry["id"],
                "triggers": triggers,
                "content": entry["body"] or entry["title"],
                "priority": entry.get("priority", 0),
                "match_type": entry.get("match_type", "keyword"),
                "insert_at": entry.get("insert_at", "start"),
            }
        )
    messages = [{"content": message}]
    matched = match_lorebook_entries(
        messages, lorebook_entries, scan_depth, token_budget
    )
    matched_ids = {m["id"] for m in matched}
    response_entries = []
    for row in rows:
        if dict(row)["id"] in matched_ids:
            r = dict(row)
            r["tags"] = _json_loads(r.pop("tags_json", "[]"), [])
            r["triggers"] = _json_loads(r.pop("triggers_json", "[]"), [])
            response_entries.append(r)
    return {
        "matched": len(matched) > 0,
        "entries": response_entries,
        "count": len(response_entries),
    }


@router.get("/characters")
def list_characters(request: Request) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    world_id = request.query_params.get("world_id", "default")
    with db.get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM rp_character WHERE world_id=? ORDER BY name ASC",
            (world_id,),
        ).fetchall()
    characters = []
    for row in rows:
        c = dict(row)
        c["tags"] = _json_loads(c.pop("tags_json", "[]"), [])
        c["extensions"] = _json_loads(c.pop("extensions_json", "{}"), {})
        characters.append(c)
    return {"characters": characters}


@router.get("/characters/{char_id}")
def get_character(char_id: str) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    with db.get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM rp_character WHERE id=?", (char_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail={"error": "Character not found"})
    c = dict(row)
    c["tags"] = _json_loads(c.pop("tags_json", "[]"), [])
    c["extensions"] = _json_loads(c.pop("extensions_json", "{}"), {})
    return {"character": c}


@router.post("/characters/import")
def import_character(payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    world_id = str(payload.get("world_id") or "default")
    card = payload.get("card", {})
    if not isinstance(card, dict):
        raise HTTPException(status_code=400, detail={"error": "card must be an object"})

    data = card.get("data", card)
    name = str(data.get("name") or "").strip()
    if not name:
        raise HTTPException(
            status_code=400, detail={"error": "character name is required"}
        )

    char_id = _gen_id()
    now = _now_ms()
    tags = data.get("tags", [])
    extensions = data.get("extensions", {})

    with db.get_connection() as conn:
        conn.execute(
            """INSERT INTO rp_character
               (id, world_id, name, description, personality, scenario, first_mes, mes_example,
                system_prompt, post_history_instructions, creator_notes, character_version,
                tags_json, creator, extensions_json, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                char_id,
                world_id,
                name,
                str(data.get("description") or ""),
                str(data.get("personality") or ""),
                str(data.get("scenario") or ""),
                str(data.get("first_mes") or ""),
                str(data.get("mes_example") or ""),
                str(data.get("system_prompt") or ""),
                str(data.get("post_history_instructions") or ""),
                str(data.get("creator_notes") or ""),
                str(data.get("character_version") or ""),
                _json_dumps(tags if isinstance(tags, list) else []),
                str(data.get("creator") or ""),
                _json_dumps(extensions if isinstance(extensions, dict) else {}),
                now,
                now,
            ),
        )
        conn.commit()
    character = {
        "id": char_id,
        "world_id": world_id,
        "name": name,
        "description": str(data.get("description") or ""),
        "personality": str(data.get("personality") or ""),
        "scenario": str(data.get("scenario") or ""),
        "first_mes": str(data.get("first_mes") or ""),
        "mes_example": str(data.get("mes_example") or ""),
        "system_prompt": str(data.get("system_prompt") or ""),
        "creator_notes": str(data.get("creator_notes") or ""),
        "character_version": str(data.get("character_version") or ""),
        "tags": tags if isinstance(tags, list) else [],
        "creator": str(data.get("creator") or ""),
        "extensions": extensions if isinstance(extensions, dict) else {},
        "created_at": now,
        "updated_at": now,
    }
    return {"character": character, "id": char_id}


@router.put("/characters/{char_id}")
def update_character(char_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    with db.get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM rp_character WHERE id=?", (char_id,)
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=404, detail={"error": "Character not found"}
            )
        now = _now_ms()
        fields = [
            "name",
            "description",
            "personality",
            "scenario",
            "first_mes",
            "mes_example",
            "system_prompt",
            "post_history_instructions",
            "creator_notes",
            "character_version",
            "creator",
            "avatar_url",
        ]
        updates: dict[str, Any] = {}
        for f in fields:
            if f in payload:
                updates[f] = str(payload[f] or "")
        if "tags" in payload:
            updates["tags_json"] = _json_dumps(
                payload["tags"] if isinstance(payload["tags"], list) else []
            )
        if "extensions" in payload:
            updates["extensions_json"] = _json_dumps(
                payload["extensions"] if isinstance(payload["extensions"], dict) else {}
            )
        updates["updated_at"] = now
        set_clause = ", ".join(f"{k}=?" for k in updates.keys())
        conn.execute(
            f"UPDATE rp_character SET {set_clause} WHERE id=?",
            list(updates.values()) + [char_id],
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM rp_character WHERE id=?", (char_id,)
        ).fetchone()
    c = dict(row)
    c["tags"] = _json_loads(c.pop("tags_json", "[]"), [])
    c["extensions"] = _json_loads(c.pop("extensions_json", "{}"), {})
    return c


@router.delete("/characters/{char_id}")
def delete_character(char_id: str) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    with db.get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM rp_character WHERE id=?", (char_id,)
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=404, detail={"error": "Character not found"}
            )
        conn.execute("DELETE FROM rp_character WHERE id=?", (char_id,))
        conn.commit()
    return {"ok": True, "deleted_id": char_id}


@router.get("/rooms")
def list_rooms() -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    with db.get_connection() as conn:
        rooms_rows = conn.execute(
            "SELECT * FROM rp_room ORDER BY created_at DESC",
        ).fetchall()
        rooms = []
        for row in rooms_rows:
            r = dict(row)
            part_rows = conn.execute(
                "SELECT character_id FROM rp_room_participant WHERE room_id=?",
                (r["id"],),
            ).fetchall()
            r["participants"] = [p["character_id"] for p in part_rows]
            r["archived"] = bool(r.get("archived", 0))
            rooms.append(r)
    return {"rooms": rooms}


@router.post("/rooms")
def create_room(payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    name = str(payload.get("name") or "").strip() or None
    world_id = str(payload.get("world_id") or "default")
    room_id = _gen_id()
    now = _now_ms()
    with db.get_connection() as conn:
        conn.execute(
            """INSERT INTO rp_room (id, name, world_id, created_at, status, archived)
               VALUES (?,?,?,?,?,?)""",
            (room_id, name, world_id, now, "active", 0),
        )
        conn.commit()
    room = {
        "id": room_id,
        "name": name,
        "world_id": world_id,
        "created_at": now,
        "status": "active",
        "archived": False,
        "participants": [],
    }
    _broadcast("room_created", {"room": room})
    return {"room": room}


@router.post("/rooms/{room_id}/archive")
def archive_room(room_id: str) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    with db.get_connection() as conn:
        row = conn.execute("SELECT id FROM rp_room WHERE id=?", (room_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"error": "Room not found"})
        conn.execute(
            "UPDATE rp_room SET archived=1, status='archived' WHERE id=?", (room_id,)
        )
        conn.commit()
    return {"ok": True}


@router.get("/rooms/{room_id}/messages")
def list_messages(room_id: str, request: Request) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    try:
        limit = min(int(request.query_params.get("limit", "100")), 500)
    except Exception:
        limit = 100
    with db.get_connection() as conn:
        row = conn.execute("SELECT id FROM rp_room WHERE id=?", (room_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"error": "Room not found"})
        msg_rows = conn.execute(
            "SELECT * FROM rp_room_message WHERE room_id=? ORDER BY id ASC LIMIT ?",
            (room_id, limit),
        ).fetchall()
    messages = []
    for m in msg_rows:
        msg = dict(m)
        msg["ts"] = msg.get("created_at")
        messages.append(msg)
    return {"messages": messages}


@router.post("/rooms/{room_id}/messages")
def send_message(room_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    content = str(payload.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail={"error": "content is required"})
    role = str(payload.get("role") or "user")
    author = str(payload.get("author") or role)
    character_id = str(payload.get("character_id") or "")
    kind = str(payload.get("kind") or "chat")
    now = _now_ms()
    with db.get_connection() as conn:
        row = conn.execute("SELECT id FROM rp_room WHERE id=?", (room_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"error": "Room not found"})
        cursor = conn.execute(
            """INSERT INTO rp_room_message (room_id, character_id, author, role, content, created_at, kind)
               VALUES (?,?,?,?,?,?,?)""",
            (room_id, character_id, author, role, content, now, kind),
        )
        conn.commit()
        msg_id = cursor.lastrowid
    message = {
        "id": str(msg_id),
        "room_id": room_id,
        "character_id": character_id,
        "author": author,
        "role": role,
        "content": content,
        "created_at": now,
        "ts": now,
        "kind": kind,
    }
    _broadcast("rp_message", message)
    return {"message": message}


@router.post("/rooms/{room_id}/participants")
def add_participant(room_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    character_id = str(payload.get("character_id") or "").strip()
    if not character_id:
        raise HTTPException(
            status_code=400, detail={"error": "character_id is required"}
        )
    now = _now_ms()
    with db.get_connection() as conn:
        row = conn.execute("SELECT id FROM rp_room WHERE id=?", (room_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"error": "Room not found"})
        conn.execute(
            "INSERT OR IGNORE INTO rp_room_participant (room_id, character_id, joined_at) VALUES (?,?,?)",
            (room_id, character_id, now),
        )
        conn.commit()
    return {"ok": True, "room_id": room_id, "character_id": character_id}


@router.delete("/rooms/{room_id}/participants/{character_id}")
def remove_participant(room_id: str, character_id: str) -> dict[str, Any]:
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail={"error": "DB not initialized"})
    with db.get_connection() as conn:
        conn.execute(
            "DELETE FROM rp_room_participant WHERE room_id=? AND character_id=?",
            (room_id, character_id),
        )
        conn.commit()
    return {"ok": True}
