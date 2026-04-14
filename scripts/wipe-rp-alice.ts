#!/usr/bin/env bun
/** Wipe all memory/cognition/graph/session state for agent rp:alice before a fresh test run. */
import { Database } from "bun:sqlite";

const dbPath = process.argv[2] ?? "D:/Projects/MaidsClaw/data/maidsclaw.db";
const agentId = "rp:alice";

const db = new Database(dbPath);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all() as Array<{ name: string }>;

const dropByAgent: Record<string, string> = {};
const dropBySession: string[] = [];

for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all() as Array<{ name: string }>;
  const names = cols.map((c) => c.name);
  if (names.includes("agent_id")) {
    dropByAgent[t.name] = "agent_id";
  } else if (names.includes("session_id")) {
    dropBySession.push(t.name);
  }
}

console.log("tables with agent_id:", Object.keys(dropByAgent));
console.log("tables with session_id only:", dropBySession);

const sessions = db
  .prepare("SELECT session_id FROM sessions WHERE agent_id = ?")
  .all(agentId) as Array<{ session_id: string }>;
const sessionIds = sessions.map((s) => s.session_id);
console.log(`rp:alice has ${sessionIds.length} existing sessions`);

db.exec("BEGIN");
try {
  for (const tbl of Object.keys(dropByAgent)) {
    const res = db.prepare(`DELETE FROM ${tbl} WHERE agent_id = ?`).run(agentId);
    if (res.changes > 0) console.log(`  ${tbl}: -${res.changes}`);
  }
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => "?").join(",");
    for (const tbl of dropBySession) {
      const res = db
        .prepare(`DELETE FROM ${tbl} WHERE session_id IN (${placeholders})`)
        .run(...sessionIds);
      if (res.changes > 0) console.log(`  ${tbl}: -${res.changes}`);
    }
  }
  db.exec("COMMIT");
  console.log("wipe OK");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("wipe failed:", e);
  process.exit(1);
}

db.close();
