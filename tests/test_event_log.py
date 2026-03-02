import json
import os
import threading
import time

import event_log


def _read_jsonl(path: str):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip("\n")
            if not line:
                continue
            yield json.loads(line)


def test_concurrent_event_appends_threads(tmp_path):
    event_path = tmp_path / "events.jsonl"

    total = 100
    threads = 20
    per_thread = total // threads
    barrier = threading.Barrier(threads)

    def worker(tid: int):
        barrier.wait()
        for i in range(per_thread):
            event_log.append_event(
                "test.concurrent",
                orchestrated=False,
                payload={"tid": tid, "i": i},
                event_log_path=str(event_path),
            )

    ts = [threading.Thread(target=worker, args=(t,)) for t in range(threads)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(timeout=10)
        assert not t.is_alive()

    events = list(_read_jsonl(str(event_path)))
    assert len(events) == total
    for ev in events:
        for key in ("ts_ms", "kind", "trace_id", "run_id", "agent_id", "session_id", "payload", "orchestrated"):
            assert key in ev
        assert isinstance(ev["orchestrated"], bool)
        assert ev["kind"] == "test.concurrent"


def test_stale_lock_replaced(tmp_path):
    event_path = tmp_path / "events.jsonl"
    lock_path = str(event_path) + ".lock"
    os.makedirs(tmp_path, exist_ok=True)

    with open(lock_path, "w", encoding="utf-8") as f:
        f.write("stale")

    old = time.time() - 999
    os.utime(lock_path, (old, old))

    event_log.append_event(
        "test.stale",
        orchestrated=False,
        payload={"ok": True},
        event_log_path=str(event_path),
    )

    assert not os.path.exists(lock_path)
    events = list(_read_jsonl(str(event_path)))
    assert len(events) == 1
    assert events[0]["kind"] == "test.stale"
