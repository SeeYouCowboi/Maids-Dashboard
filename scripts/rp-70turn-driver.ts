#!/usr/bin/env bun
/**
 * RP 70-turn test driver.
 *
 * Usage:
 *   bun scripts/rp-70turn-driver.ts <sessionId> <turnNumber>
 *   bun scripts/rp-70turn-driver.ts <sessionId> <from> <to>
 *
 * Reads turn messages from `scripts/rp-70turn-messages.json`.
 * Streams the SSE reply and prints just the assistant_text and private_cognition summary.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.MAIDSCLAW_BASE ?? "http://localhost:18790";
const TOKEN = process.env.MAIDSCLAW_TOKEN ?? "maidsclaw";

const [sessionId, fromArg, toArg] = process.argv.slice(2);
if (!sessionId || !fromArg) {
  console.error("usage: bun rp-70turn-driver.ts <sessionId> <turn> [<toTurn>]");
  process.exit(2);
}

const from = Number(fromArg);
const to = toArg ? Number(toArg) : from;

const messagesPath = resolve(import.meta.dir, "rp-70turn-messages.json");
const messages: Record<string, string> = JSON.parse(readFileSync(messagesPath, "utf8"));

const logPath = resolve(import.meta.dir, "..", "rp-70turn-log.txt");

interface TurnResult {
  assistantText: string;
  done: boolean;
  error?: string;
  requestId: string;
}

async function runTurn(turn: number): Promise<TurnResult> {
  const text = messages[String(turn)];
  if (!text) throw new Error(`Missing message for turn ${turn}`);
  const requestId = randomUUID();
  const body = {
    agent_id: "rp:alice",
    request_id: requestId,
    user_message: { text },
  };

  const res = await fetch(`${BASE}/v1/sessions/${sessionId}/turns:stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    return { assistantText: "", done: false, error: `HTTP ${res.status}: ${await res.text()}`, requestId };
  }

  let assistantText = "";
  let done = false;
  let error: string | undefined;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done: eof } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const e of events) {
      const lines = e.split("\n");
      let data = "";
      for (const l of lines) {
        if (l.startsWith("data:")) data += l.slice(5).trim();
      }
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        const type = parsed.type;
        const payload = parsed.data ?? {};
        if (type === "delta" && typeof payload.text === "string") {
          assistantText += payload.text;
        } else if (type === "done") {
          done = true;
        } else if (type === "error") {
          error = JSON.stringify(payload);
        }
      } catch {}
    }
  }
  return { assistantText, done, error, requestId };
}

async function runTurnWithRetry(turn: number, maxAttempts = 3): Promise<TurnResult> {
  let last: TurnResult | null = null;
  for (let a = 1; a <= maxAttempts; a++) {
    try {
      const r = await runTurn(turn);
      if (!r.error && r.assistantText.length > 0) return r;
      last = r;
    } catch (e) {
      last = { assistantText: "", done: false, error: String(e), requestId: "exception" };
    }
    await new Promise((res) => setTimeout(res, 1500 * a));
  }
  return last ?? { assistantText: "", done: false, error: "no result", requestId: "none" };
}

for (let t = from; t <= to; t++) {
  const send = messages[String(t)] ?? "";
  console.log(`\n=== Turn ${t} ===`);
  console.log(`[SEND] ${send}`);
  const r = await runTurnWithRetry(t);
  if (r.error) {
    console.log(`[ERROR] ${r.error}`);
  } else {
    console.log(`[REQ] ${r.requestId}`);
    console.log(`[RECV] ${r.assistantText.trim()}`);
  }
  appendFileSync(
    logPath,
    `\n=== Turn ${t} ===\n[REQ] ${r.requestId}\n[SEND] ${send}\n[RECV] ${r.assistantText.trim()}\n${r.error ? `[ERROR] ${r.error}\n` : ""}`,
  );
  // small pacing between turns
  await new Promise((res) => setTimeout(res, 400));
}
