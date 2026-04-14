#!/usr/bin/env bun
/** Probe per-turn timings: TTFB (first delta), last delta, done. */
import { randomUUID } from "node:crypto";

const BASE = "http://localhost:18790";
const TOKEN = "maidsclaw";

const sessionId = process.argv[2];
const text = process.argv[3] ?? "早安，今天庄园里安静得有点过头。";
if (!sessionId) {
  console.error("usage: bun rp-timing-probe.ts <sessionId> [text]");
  process.exit(2);
}

const requestId = randomUUID();
const start = performance.now();
const res = await fetch(`${BASE}/v1/sessions/${sessionId}/turns:stream`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({
    agent_id: "rp:alice",
    request_id: requestId,
    user_message: { text },
  }),
});
const headersDone = performance.now();

let firstDelta: number | null = null;
let lastDelta: number | null = null;
let done: number | null = null;
let totalChars = 0;
let deltaCount = 0;

const reader = res.body!.getReader();
const dec = new TextDecoder();
let buf = "";
while (true) {
  const { value, done: eof } = await reader.read();
  if (eof) break;
  buf += dec.decode(value, { stream: true });
  const events = buf.split("\n\n");
  buf = events.pop() ?? "";
  for (const e of events) {
    const data = e
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (!data) continue;
    try {
      const p = JSON.parse(data);
      if (p.type === "delta") {
        if (firstDelta == null) firstDelta = performance.now();
        lastDelta = performance.now();
        totalChars += (p.data?.text ?? "").length;
        deltaCount += 1;
      } else if (p.type === "done") {
        done = performance.now();
      }
    } catch {}
  }
}

const ms = (v: number | null) => (v == null ? "-" : `${Math.round(v - start)}ms`);
console.log(`request_id: ${requestId}`);
console.log(`headers   : ${ms(headersDone)}`);
console.log(`first_delta: ${ms(firstDelta)}`);
console.log(`last_delta: ${ms(lastDelta)}`);
console.log(`done      : ${ms(done)}`);
console.log(`deltas    : ${deltaCount}`);
console.log(`chars     : ${totalChars}`);
