#!/usr/bin/env bun
/** Wipe all memory/cognition/graph/session state for agent rp:alice in Postgres. */
import { SQL } from "bun";

const url = process.env.PG_APP_URL ?? "postgres://maidsclaw:maidsclaw@127.0.0.1:55432/maidsclaw_app";
const sql = new SQL(url);

const agentId = "rp:alice";

const tables = await sql`
  SELECT c.table_name,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = c.table_name AND column_name = 'agent_id'
         ) AS has_agent,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = c.table_name AND column_name = 'session_id'
         ) AS has_session
  FROM (SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public') c
  ORDER BY c.table_name
`;

const byAgent: string[] = [];
const bySessionOnly: string[] = [];
for (const t of tables as Array<{ table_name: string; has_agent: boolean; has_session: boolean }>) {
  if (t.has_agent) byAgent.push(t.table_name);
  else if (t.has_session) bySessionOnly.push(t.table_name);
}

console.log("tables with agent_id:", byAgent);
console.log("tables with session_id only:", bySessionOnly);

const sessRows = await sql`SELECT session_id FROM sessions WHERE agent_id = ${agentId}`;
const sessionIds = (sessRows as Array<{ session_id: string }>).map((r) => r.session_id);
console.log(`rp:alice sessions: ${sessionIds.length}`);

// Tables protected by append-only fn_deny_delete_* triggers.
// We temporarily disable those triggers so test wipes can reach the audit ledgers.
const appendOnlyTables = new Set([
  "private_cognition_events",
  "private_episode_events",
  "area_state_events",
]);

const skipped: string[] = [];
for (const tbl of byAgent) {
  try {
    if (appendOnlyTables.has(tbl)) {
      await sql.unsafe(`ALTER TABLE "${tbl}" DISABLE TRIGGER trg_${tbl}_no_delete`);
    }
    const res = await sql.unsafe(`DELETE FROM "${tbl}" WHERE agent_id = $1`, [agentId]);
    const count = (res as { count?: number })?.count ?? 0;
    if (count > 0) console.log(`  ${tbl}: -${count}`);
  } catch (e: any) {
    skipped.push(`${tbl} (${e?.errno ?? "err"})`);
  } finally {
    if (appendOnlyTables.has(tbl)) {
      try {
        await sql.unsafe(`ALTER TABLE "${tbl}" ENABLE TRIGGER trg_${tbl}_no_delete`);
      } catch {}
    }
  }
}
if (sessionIds.length > 0) {
  for (const tbl of bySessionOnly) {
    try {
      const res = await sql.unsafe(
        `DELETE FROM "${tbl}" WHERE session_id = ANY($1::text[])`,
        [sessionIds],
      );
      const count = (res as { count?: number })?.count ?? 0;
      if (count > 0) console.log(`  ${tbl}: -${count}`);
    } catch (e: any) {
      skipped.push(`${tbl} (${e?.errno ?? "err"})`);
    }
  }
}
if (skipped.length > 0) console.log("skipped (append-only):", skipped);

// Also truncate the durable job tables. These are NOT keyed by agent_id,
// so previous test runs leave pending/succeeded rows that pollute new runs
// (the thinker would otherwise replay backlog from old sessions).
for (const tbl of ["jobs_current", "job_attempts"]) {
  try {
    const res = await sql.unsafe(`DELETE FROM "${tbl}"`);
    const count = (res as { count?: number })?.count ?? 0;
    if (count > 0) console.log(`  ${tbl}: -${count} (full truncate)`);
  } catch (e: any) {
    console.log(`  ${tbl}: skip (${e?.errno ?? "err"})`);
  }
}

console.log("wipe OK");
await sql.end();
