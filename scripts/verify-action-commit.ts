#!/usr/bin/env bun
/**
 * Direct-API verification for P0 fix: send a narrated action and check
 * area_state_events / scene_area_fact_events get populated.
 */
import { SQL } from "bun"

const GATEWAY = "http://localhost:18790"
const TOKEN = "maidsclaw"
const PG_URL = "postgres://maidsclaw:maidsclaw@127.0.0.1:5432/maidsclaw_app"

async function createSession(): Promise<string> {
  const res = await fetch(`${GATEWAY}/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ agent_id: "rp:mei" }),
  })
  if (!res.ok) throw new Error(`create session ${res.status}`)
  const data = (await res.json()) as { session_id?: string; id?: string }
  return data.session_id ?? data.id ?? ""
}

async function sendTurnStreaming(sessionId: string, text: string): Promise<string> {
  const res = await fetch(`${GATEWAY}/v1/sessions/${sessionId}/turns:stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ user_message: { text } }),
  })
  if (!res.ok || !res.body) throw new Error(`send turn ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let reply = ""
  let buf = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data: ")) continue
      const payload = trimmed.slice(6)
      if (!payload) continue
      let parsed: any
      try { parsed = JSON.parse(payload) } catch { continue }
      if (parsed.type === "delta" && typeof parsed.data?.text === "string") {
        reply += parsed.data.text
      }
      if (parsed.type === "done") return reply
      if (parsed.type === "error") throw new Error(`SSE error: ${parsed.message ?? parsed.data?.message ?? ""}`)
    }
  }
  return reply
}

const sql = new SQL(PG_URL)

console.log("[verify] creating session ...")
const sessionId = await createSession()
console.log(`[verify] session = ${sessionId}`)

const turns = [
  "早安，今天庄园里安静得有点过头。",
  "我拿起金怀表。",
  "我放下金怀表。",
  "我打开窗户。",
  "关上窗户。",
]

for (const [i, t] of turns.entries()) {
  console.log(`\n[turn ${i + 1}/${turns.length}] send: ${t}`)
  const reply = await sendTurnStreaming(sessionId, t)
  console.log(`[turn ${i + 1}] reply (${reply.length}c): ${reply.slice(0, 100)}`)
}

console.log("\n[verify] querying PG ...")
const [areaE] = (await sql`SELECT COUNT(*)::int AS c FROM area_state_events`) as Array<{ c: number }>
const [areaC] = (await sql`SELECT COUNT(*)::int AS c FROM area_state_current`) as Array<{ c: number }>
const [sceneE] = (await sql`SELECT COUNT(*)::int AS c FROM scene_area_fact_events`) as Array<{ c: number }>
const [sceneC] = (await sql`SELECT COUNT(*)::int AS c FROM scene_area_fact_current`) as Array<{ c: number }>

console.log(`area_state_events      = ${areaE.c}`)
console.log(`area_state_current     = ${areaC.c}`)
console.log(`scene_area_fact_events = ${sceneE.c}`)
console.log(`scene_area_fact_current= ${sceneC.c}`)

const rows = (await sql`
  SELECT fact_key, value_json::text AS v
  FROM scene_area_fact_events
  ORDER BY id DESC LIMIT 20
`) as Array<{ fact_key: string; v: string }>
console.log("\nrecent scene_area_fact_events:")
for (const r of rows) console.log(` ${r.fact_key} = ${r.v}`)

const legacyRows = (await sql`
  SELECT key, value_json::text AS v FROM area_state_events ORDER BY id DESC LIMIT 20
`) as Array<{ key: string; v: string }>
console.log("\nrecent area_state_events (legacy):")
for (const r of legacyRows) console.log(` ${r.key} = ${r.v}`)

await sql.end()
console.log("\n[verify] done.")
