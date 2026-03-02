import json
import os
import sqlite3
import time

import session_ingest


def _read_jsonl(path: str):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip("\n")
            if not line:
                continue
            yield json.loads(line)


def _make_run_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE run (
            speaker TEXT NOT NULL,
            session_id TEXT NOT NULL,
            message_offset INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            agent_id TEXT,
            kind TEXT,
            trace_id TEXT,
            run_id TEXT,
            orchestrated INTEGER,
            ts_ms INTEGER,
            payload TEXT,
            payload_json TEXT,
            PRIMARY KEY (speaker, session_id, message_offset, updated_at_ms)
        )
        """
    )
    conn.commit()
    return conn


def test_ignore_deleted_logs_and_stale_index_fallback_and_corrupt_line(tmp_path):
    root = tmp_path
    agents_dir = root / "agents" / "a1" / "sessions"
    agents_dir.mkdir(parents=True)

    good1 = agents_dir / "s1.jsonl"
    good2 = agents_dir / "s2.jsonl"
    deleted = agents_dir / "s_deleted.jsonl.deleted.1700000000"

    good1.write_text(
        "\n".join(
            [
                json.dumps({"speaker": "user", "ts_ms": 111, "content": "hello"}),
                "{this is not json}",
                json.dumps({"speaker": "assistant", "ts_ms": 222, "content": "world"}),
                "",
            ]
        ),
        encoding="utf-8",
    )
    good2.write_text(json.dumps({"speaker": "system", "ts_ms": 333, "content": "ok"}) + "\n", encoding="utf-8")
    deleted.write_text(json.dumps({"speaker": "user", "ts_ms": 1, "content": "should not ingest"}) + "\n", encoding="utf-8")

    index_path = root / "agents" / "sessions.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(
        json.dumps(
            [
                os.path.join("agents", "a1", "sessions", deleted.name),
                os.path.join("agents", "a1", "sessions", good1.name),
            ]
        ),
        encoding="utf-8",
    )
    now_s = time.time()
    old = now_s - 600
    os.utime(index_path, (old, old))

    db_path = str(root / "canon.db")
    conn = _make_run_db(db_path)
    event_log_path = str(root / "events.jsonl")

    stats = session_ingest.ingest_sessions(
        openclaw_root=str(root),
        conn=conn,
        event_log_path=event_log_path,
        now_ms_value=int(now_s * 1000),
    )

    assert stats.files_seen == 2
    assert stats.files_ingested == 2
    assert stats.messages_ingested == 3
    assert stats.errors == 1

    cur = conn.execute("SELECT speaker, session_id, message_offset, updated_at_ms FROM run ORDER BY session_id, message_offset")
    rows = cur.fetchall()
    conn.close()
    assert rows == [
        ("user", "s1", 0, 111),
        ("assistant", "s1", 2, 222),
        ("system", "s2", 0, 333),
    ]

    events = list(_read_jsonl(event_log_path))
    assert len(events) == 1
    assert events[0]["kind"] == "session.ingest.error"
    assert events[0]["payload"]["file_path"].endswith(os.path.join("agents", "a1", "sessions", "s1.jsonl"))
    assert events[0]["payload"]["line_number"] == 2
    assert "error" in events[0]["payload"]
