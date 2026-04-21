#!/usr/bin/env bun
/**
 * Entity embedding baseline — measures cosine similarity between known
 * synonym pairs using the same Bailian text-embedding-v4 model that the
 * EntityReconciliationSweeper uses.
 *
 * Purpose: decide whether the default mergeThreshold=0.85 / borderline=0.70
 * are usable for cross-language entity reconciliation in the rp:mei scenario.
 *
 * Usage: bun scripts/entity-embedding-baseline.ts
 */

const API_KEY = "sk-3af0820e3d814fa99907f9280d4d9b73"
const MODEL_ID = "text-embedding-v4"
const ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings"

type Pair = { a: string; b: string; kind: string; note?: string }

// Pairs covering the relevant dimensions for our reconciliation scenario.
const PAIRS: Pair[] = [
  // ─── Cross-language same-concept (the main question) ──────────
  { a: "花房", b: "greenhouse", kind: "cross-lang-loc" },
  { a: "茶室", b: "tea_room", kind: "cross-lang-loc" },
  { a: "温室", b: "conservatory", kind: "cross-lang-loc" },
  { a: "书房", b: "study", kind: "cross-lang-loc" },
  { a: "管家", b: "butler", kind: "cross-lang-char" },
  { a: "梅姨", b: "aunt_mei", kind: "cross-lang-char" },
  { a: "银怀表", b: "silver_pocket_watch", kind: "cross-lang-obj" },
  { a: "金怀表", b: "gold_pocket_watch", kind: "cross-lang-obj" },

  // ─── Same-language alias (same concept, different surface) ────
  { a: "梅", b: "梅姨", kind: "same-lang-alias", note: "short vs formal" },
  { a: "Alice", b: "爱丽丝", kind: "cross-lang-name" },
  { a: "银表", b: "银怀表", kind: "same-lang-alias", note: "abbrev" },

  // ─── Related-but-distinct (must NOT merge) ───────────────────
  { a: "茶室", b: "书房", kind: "neg-related-loc", note: "both 室, diff room" },
  { a: "花房", b: "温室", kind: "neg-related-loc", note: "both plants, diff" },
  { a: "管家", b: "梅姨", kind: "neg-related-char", note: "both staff" },
  { a: "金怀表", b: "银怀表", kind: "neg-related-obj", note: "both watches" },

  // ─── Totally unrelated (sanity floor) ────────────────────────
  { a: "茶室", b: "金怀表", kind: "neg-unrelated" },
  { a: "Alice", b: "银怀表", kind: "neg-unrelated" },

  // ─── Context-enriched form (simulates embedding pointer_key + summary)
  // Current sweeper ONLY embeds pointer_key/display_name. These pairs test
  // whether adding the entity's summary/description to the embedding text
  // lifts the cross-language signal above the noise floor.
  {
    a: "花房：庄园花房，Alice 常在此处出没",
    b: "greenhouse: the manor greenhouse where Alice often spends time",
    kind: "ctx-cross-lang-loc",
  },
  {
    a: "茶室：庄园内靠窗的茶室，光线柔和，主人常在此饮茶",
    b: "tea_room: sunlit tea room by the window where the master often drinks tea",
    kind: "ctx-cross-lang-loc",
  },
  {
    a: "管家：庄园管家，负责库房清单和账目管理",
    b: "butler: the manor butler, in charge of inventory and accounts",
    kind: "ctx-cross-lang-char",
  },
  {
    a: "金怀表：主人今早带着的金色怀表",
    b: "gold_pocket_watch: the golden pocket watch the master carried this morning",
    kind: "ctx-cross-lang-obj",
  },
  // Asymmetric: catalog side has context, candidate is bare
  {
    a: "花房：庄园花房，Alice 常在此处出没",
    b: "greenhouse",
    kind: "ctx-asymmetric",
  },
  {
    a: "greenhouse: the manor greenhouse where Alice often spends time",
    b: "花房",
    kind: "ctx-asymmetric",
  },
  // Negatives with context (must stay below positives)
  {
    a: "金怀表：主人今早带着的金色怀表",
    b: "银怀表：主人早上从茶室落下的银色怀表",
    kind: "ctx-neg-related",
  },
  {
    a: "管家：庄园管家，负责库房清单和账目管理",
    b: "梅姨：庄园厨娘，手艺好，嘴碎",
    kind: "ctx-neg-related",
  },
]

async function embed(texts: string[]): Promise<Float32Array[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL_ID,
      input: texts,
      user: "memory_index",
    }),
  })
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`)
  const payload = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>
  }
  return payload.data
    .sort((x, y) => x.index - y.index)
    .map((d) => new Float32Array(d.embedding))
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function classify(sim: number): string {
  if (sim >= 0.85) return "MERGE    "
  if (sim >= 0.7) return "BORDER   "
  if (sim >= 0.6) return "CLUSTER  "
  return "NEW      "
}

async function main() {
  const allTexts = Array.from(new Set(PAIRS.flatMap((p) => [p.a, p.b])))
  console.log(`embedding ${allTexts.length} unique strings via ${MODEL_ID} ...`)

  // Bailian caps at 10 per request
  const CHUNK = 10
  const vectors = new Map<string, Float32Array>()
  for (let i = 0; i < allTexts.length; i += CHUNK) {
    const slice = allTexts.slice(i, i + CHUNK)
    const vs = await embed(slice)
    for (let j = 0; j < slice.length; j++) vectors.set(slice[j], vs[j])
  }

  const groups = new Map<string, Array<Pair & { sim: number }>>()
  for (const p of PAIRS) {
    const va = vectors.get(p.a)!
    const vb = vectors.get(p.b)!
    const sim = cosine(va, vb)
    if (!groups.has(p.kind)) groups.set(p.kind, [])
    groups.get(p.kind)!.push({ ...p, sim })
  }

  console.log(
    "\nDefault thresholds from entity-reconciliation-sweeper:  merge=0.85  borderline=0.70  cluster=0.60\n",
  )
  console.log("sim    | verdict    | a               ↔ b               | note")
  console.log(
    "-".repeat(6) +
      "-+-" +
      "-".repeat(10) +
      "-+-" +
      "-".repeat(30) +
      "--+-" +
      "-".repeat(10),
  )

  for (const kind of [
    "cross-lang-loc",
    "cross-lang-char",
    "cross-lang-obj",
    "cross-lang-name",
    "same-lang-alias",
    "neg-related-loc",
    "neg-related-char",
    "neg-related-obj",
    "neg-unrelated",
    "ctx-cross-lang-loc",
    "ctx-cross-lang-char",
    "ctx-cross-lang-obj",
    "ctx-asymmetric",
    "ctx-neg-related",
  ]) {
    const rows = groups.get(kind)
    if (!rows) continue
    console.log(`\n── ${kind} ──`)
    for (const r of rows) {
      const label = `${r.a.padEnd(14)} ↔ ${r.b.padEnd(18)}`
      const noteStr = r.note ? `  ← ${r.note}` : ""
      console.log(
        `${r.sim.toFixed(3)}  | ${classify(r.sim)}| ${label}${noteStr}`,
      )
    }
  }

  console.log("\n── summary stats ──")
  const byKind = (k: string) => {
    const arr = groups.get(k) ?? []
    if (arr.length === 0) return "(none)"
    const sims = arr.map((r) => r.sim)
    const min = Math.min(...sims)
    const max = Math.max(...sims)
    const avg = sims.reduce((a, b) => a + b, 0) / sims.length
    return `min=${min.toFixed(3)} avg=${avg.toFixed(3)} max=${max.toFixed(3)}  n=${sims.length}`
  }
  console.log(`positive (should merge):    ${byKind("cross-lang-loc")}  [cross-lang-loc]`)
  console.log(`                            ${byKind("cross-lang-char")}  [cross-lang-char]`)
  console.log(`                            ${byKind("cross-lang-obj")}  [cross-lang-obj]`)
  console.log(`                            ${byKind("cross-lang-name")}  [cross-lang-name]`)
  console.log(`                            ${byKind("same-lang-alias")}  [same-lang-alias]`)
  console.log(`negative (should NOT merge):${byKind("neg-related-loc")}  [neg-related-loc]`)
  console.log(`                            ${byKind("neg-related-char")}  [neg-related-char]`)
  console.log(`                            ${byKind("neg-related-obj")}  [neg-related-obj]`)
  console.log(`                            ${byKind("neg-unrelated")}  [neg-unrelated]`)
}

await main()
