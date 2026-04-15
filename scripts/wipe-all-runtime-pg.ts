#!/usr/bin/env bun
/** Wipe ALL runtime state from maidsclaw_app Postgres (all agents, all sessions).
 *
 *  PRESERVES:
 *    - Schema and _migrations tables
 *    - config/*.json (personas, lorebook, agents, providers — file-based, not in DB)
 *
 *  AFTER RUNNING: restart MaidsClaw so its in-memory trace store clears
 *  AND so the new controllers.ts / memory.ts schema changes load. */
import { SQL } from "bun"

const url =
  process.env.PG_APP_URL ?? "postgres://maidsclaw:maidsclaw@127.0.0.1:55432/maidsclaw_app"
const sql = new SQL(url)

const RUNTIME_TABLES = [
  "sessions",
  "interaction_records",
  "recent_cognition_slots",
  "pending_settlement_recovery",
  "settlement_processing_ledger",
  "event_nodes",
  "logic_edges",
  "topics",
  "fact_edges",
  "entity_nodes",
  "entity_aliases",
  "pointer_redirects",
  "core_memory_blocks",
  "memory_relations",
  "shared_blocks",
  "shared_block_sections",
  "shared_block_admins",
  "shared_block_attachments",
  "shared_block_patch_log",
  "shared_block_snapshots",
  "private_episode_events",
  "private_cognition_events",
  "area_state_events",
  "world_state_events",
  "private_cognition_current",
  "area_state_current",
  "area_narrative_current",
  "world_state_current",
  "world_narrative_current",
  "search_docs_private",
  "search_docs_area",
  "search_docs_world",
  "search_docs_cognition",
  "search_docs_episode",
  "node_embeddings",
  "semantic_edges",
  "graph_nodes",
  "node_scores",
  "pinned_summary_proposals",
  "jobs_current",
  "job_attempts",
]

const APPEND_ONLY = new Set([
  "private_cognition_events",
  "private_episode_events",
  "area_state_events",
  "world_state_events",
])

console.log(`Connecting to ${url}`)

const existing = (await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
`) as Array<{ table_name: string }>
const existingSet = new Set(existing.map((r) => r.table_name))

const tablesToWipe = RUNTIME_TABLES.filter((t) => existingSet.has(t))
const missing = RUNTIME_TABLES.filter((t) => !existingSet.has(t))
if (missing.length > 0) console.log(`Missing in schema (skipped): ${missing.join(", ")}`)

const beforeSessions = (await sql`SELECT COUNT(*)::int AS c FROM sessions`) as Array<{ c: number }>
console.log(`Before: sessions=${beforeSessions[0]?.c ?? 0}`)

const triggersDisabled: string[] = []
for (const tbl of tablesToWipe) {
  if (!APPEND_ONLY.has(tbl)) continue
  try {
    await sql.unsafe(`ALTER TABLE "${tbl}" DISABLE TRIGGER trg_${tbl}_no_delete`)
    triggersDisabled.push(tbl)
  } catch (e) {
    console.log(`  ${tbl}: could not disable trigger (${(e as Error).message}) — skipping`)
  }
}

try {
  const tableList = tablesToWipe.map((t) => `"${t}"`).join(", ")
  await sql.unsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`)
  console.log(`Truncated ${tablesToWipe.length} tables in one atomic operation`)
} catch (e) {
  console.error(`TRUNCATE failed: ${(e as Error).message}`)
  throw e
} finally {
  for (const tbl of triggersDisabled) {
    try {
      await sql.unsafe(`ALTER TABLE "${tbl}" ENABLE TRIGGER trg_${tbl}_no_delete`)
    } catch (e) {
      console.log(`  ${tbl}: could not re-enable trigger (${(e as Error).message})`)
    }
  }
}

const afterSessions = (await sql`SELECT COUNT(*)::int AS c FROM sessions`) as Array<{ c: number }>
const afterCognition = (await sql`
  SELECT COUNT(*)::int AS c FROM private_cognition_events
`) as Array<{ c: number }>
const afterEpisodes = (await sql`
  SELECT COUNT(*)::int AS c FROM private_episode_events
`) as Array<{ c: number }>
const afterEvents = (await sql`SELECT COUNT(*)::int AS c FROM event_nodes`) as Array<{ c: number }>

console.log(
  `After: sessions=${afterSessions[0]?.c ?? 0}, cognition=${afterCognition[0]?.c ?? 0}, episodes=${afterEpisodes[0]?.c ?? 0}, events=${afterEvents[0]?.c ?? 0}`,
)
console.log("\nDone. Now restart MaidsClaw.")

await sql.end()
