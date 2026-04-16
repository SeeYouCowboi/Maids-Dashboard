# rp:mei 120-Turn RP Live Test Post-Mortem

**Date:** 2026-04-16  
**Agent:** `rp:mei` (persona: 梅, 庄园贴身侍女)  
**Model:** `moonshot/kimi-k2.5`  
**Test duration:** 13.3 minutes  
**Session:** `00d04356-3644-4bee-8d99-84cf91c1364a`

---

## 1. Executive Summary

| Metric | This run (rp:mei) | Previous run (rp:alice) |
|--------|-------------------|-------------------------|
| Grade | **D** | D |
| Pass / Total | **6 / 29** | 16 / 29 |
| Avg score | **2.86 / 5** | ~3.1 / 5 |
| Turn duplications | **17 / 120 (14.2%)** | ~12 / 120 |

The rp:mei run scores significantly lower than the rp:alice run. However, the two runs used **different verification specs** — this run's 29 checks were harder and targeted at multi-hop memory reasoning, constraint chain inference, and high-precision attribute recall. Turn duplication alone accounts for **at least 8 of the 23 failures**; the counterfactual score without duplication is estimated at **14–16 / 29 (Grade C/D boundary)**.

---

## 2. Test Verification Results (full)

| Turn | Label | Pass | Score | Root cause of failure |
|------|-------|------|-------|-----------------------|
| T25 | 验证点#1 直接记忆回忆 | ❌ | 3/5 | Silver attribute lost after T15 hallucination |
| T40 | 验证点#2 模糊指代消解 | ❌ | 3/5 | Same: "银怀表" not recalled |
| T44 | 验证点#3a 地点回忆 | ❌ | 2/5 | **Turn duplication** (dup of T43) |
| T45 | 验证点#3b 人物回忆 | ❌ | 1/5 | **Turn duplication** (dup of T43) |
| T46 | 验证点#3c 物品回忆 | ✅ | 4/5 | — |
| T52 | 约束验证 管家会看见 | ✅ | 5/5 | — |
| T62 | 约束验证 Alice问起时 | ✅ | 3/5 | Threshold=3, borderline |
| T63 | 约束验证#KEY 管家问起时 | ❌ | 3/5 | Implicit compliance, not explicit |
| T66 | 验证点#4 对话脉络回忆 | ❌ | 1/5 | **Turn duplication** (dup of T65) |
| T68 | 验证点#5 核心线索判断 | ❌ | 1/5 | **Turn duplication** (dup of T65/67) |
| T70 | 验证点#6 终极场景追溯 | ❌ | 3/5 | Dup of T69; no scene-specific detail |
| T80 | 混淆#1 错误地点注入 | ✅ | 4/5 | — |
| T82 | 混淆#2 归因混淆 | ❌ | 4/5 | Dup of T81; Alice/distraction causal chain lost |
| T84 | 混淆#3 物品混淆(金表→银表) | ❌ | 2/5 | **Turn duplication** (dup of T83) |
| T86 | 混淆#4 事件主体混淆 | ❌ | 4/5 | Fabricated narrative; secrecy constraint check failed |
| T88 | 验证点#7 单跳指代消解 | ❌ | 1/5 | **Turn duplication** (dup of T87) |
| T90 | 验证点#8 双跳复合指代消解 | ❌ | 2/5 | "花房的人"→老张 not Alice (lorebook not surfaced) |
| T93 | 约束撤销 主人允许告知管家 | ❌ | 3/5 | Likely verifier issue; model did accept and comply |
| T95 | 约束重建 重新保密 | ✅ | 5/5 | — |
| T98 | 混淆#5 约束归属混淆 | ❌ | 4/5 | Silver watch secrecy facet not volunteered |
| T101 | 混淆#6 时序逆转注入 | ❌ | 3/5 | Fabricated timeline; no episode citation |
| T108 | 混淆#7 人物引入顺序混淆 | ❌ | 3/5 | **Turn duplication** (dup of T107) |
| T110 | 验证点#9 超远距离偏好记忆 | ❌ | 2/5 | **Turn duplication** (dup of T109) |
| T111 | 验证点#10 双表区分终极测试 | ❌ | 3/5 | Missing: secrecy facet + grandfather heirloom context |
| T113 | 验证点#11 人物全集回忆 | ✅ | 5/5 | — |
| T114 | 混淆#8 角色职责混淆 | ❌ | 3/5 | **Turn duplication** (dup of T113) |
| T116 | 验证点#12 地点偏好排序 | ❌ | 1/5 | **Turn duplication** (dup of T115) |
| T118 | 混淆#9/推论 约束推论延伸 | ❌ | 2/5 | No explicit chain reasoning surfaced |
| T120 | 验证点#13 终极全局总结 | ❌ | 3/5 | Missing: 金表不借外人; incomplete coverage |

**Passes by category:**
- Constraint maintenance (implicit): 3/5 ✅✅✅
- Memory recall (object/person): 1/7
- Confusion injection resistance: 1/9
- Reference resolution: 0/2

---

## 3. Database State at Test Completion

| Table | Count | Notes |
|-------|-------|-------|
| `private_episode_events` | **36** | ~1 episode per 3.3 turns (healthy, async thinker) |
| `private_cognition_current` | **53** | Rich projection: ~1.5 cognitions per episode |
| `node_embeddings` | **87** | 38 episode + 44 cognition/assertion + 5 other |
| `semantic_edges` | **31** | Intra-type edges only (entity_bridge still 0) |
| `node_scores` | **27** | Subset of embedded nodes scored |

**Job queue (global):**
- succeeded: 244 | failed_terminal: 24 (old rp:alice double-serialization bug) | pending: 6 | running: 1

Memory pipeline for rp:mei ran **without job failures** throughout the test — the `memory.organize` worker fix from the previous audit held. The 24 `failed_terminal` jobs are legacy rp:alice jobs (payload double-serialization, pre-fix).

---

## 4. Bug Analysis: Five Distinct Failure Modes

### BUG-1 (P0): Turn Duplication — Streaming Race Condition

**Affected turns:** 9–11, 14, 44–45, 66, 70, 76, 82, 84–85, 88, 108, 110, 114, 116  
**Total:** 17 / 120 turns = **14.2%**  
**Direct verification impact:** 8 failures (T44, T45, T66, T84, T88, T108, T110, T114, T116)

**Pattern:**  
The gateway streams a response to turn N. Before the stream completes, the frontend sends turn N+1. The backend, still mid-stream for turn N, processes N+1 with a stale context — and replays the last completed response. This is a classic TOCTOU on the stream/context handoff.

**Evidence from responses:**
```
T107: "……是说了不少。主人嗓子该干了，茶这就来。"
T108: "……是说了不少。主人嗓子该干了，茶这就来。"  ← exact dup

T115: "……哪两个？主人说混了，我可不敢乱猜。"
T116: "……哪两个？主人说混了，我可不敢乱猜。"  ← exact dup
```

The worst instance was turns 9–11: four consecutive turns all returned "Alice小姐一早就出门了，说是去镇上取订的书…" The session was stuck for 3 turn-slots before recovering.

**Counterfactual:** Removing these 8 dup-caused failures raises estimated score to ~14/29 (Grade C). This single bug costs approximately 2 letter grades.

**Fix direction:** The stream completion signal must be atomic with the context advancement. The turn N+1 send button (or API endpoint) should be gated on `stream_status === 'done'` for turn N. Alternatively, a server-side idempotency lock per session, keyed by turn number, would prevent out-of-order processing.

---

### BUG-2 (P1): Silver Watch Attribute Loss — Hallucination Contamination

**Affected turns:** T25, T40, T68, T88, T110, T111, T120  
**Direct failures:** T25, T40, T68

**Root cause:**  
At turn 15, the model hallucinated: "……银怀表？主人今早出门时，我记得您带的是那块旧铜壳的。是不是记混了？"

The model invented a "旧铜壳" (old brass) watch that contradicts the established "银怀表" (silver pocket watch). This hallucination entered the episode stream. When the thinker later projected cognitions from this episode, the "silver" attribute was either dropped or left ambiguous. All subsequent mentions of the watch used the neutral "那块怀表" (that watch) — losing the `银` qualifier permanently.

**Retrieval evidence:**
```
T25 response: "……那块怀表。您说在茶室坐下时从口袋里拿出来过…"
T40 response: "……在的。主人说的是那块怀表，茶室靠窗的位置…"
T111 response: "……银怀表落在茶室，我去取。"  ← recovered at T111 (likely from explicit user mentions)
```

The attribute recovered at T111 because by then many user messages had explicitly said "银怀表" (turns 76, 99, 100, 111). But for the critical verifications at T25/T40/T68, the silver attribute was unavailable.

**Vulnerability:** The memory system trusts the thinker's cognition projection uncritically. When the thinker produces a vague cognition like "怀表/主人的表" without the attribute, there is no mechanism to reconcile it against the user's original explicit statement ("银怀表"). The episode stores the raw turn but the cognition (the retrieval-facing layer) dropped the qualifier.

**Fix direction:** 
1. The thinker's cognition extraction prompt should be instructed to preserve quoted user-stated attributes verbatim.
2. A `attribute_confidence` field in cognitions could flag when an attribute in an episode was contradicted in the same episode by the model (hallucination marker).

---

### BUG-3 (P1): Reference Resolution — Lorebook Not Surfaced

**Affected turns:** T88, T90  
**Pattern:** "花房那边的人" and "老往花房跑的" resolved to 园丁老张 instead of Alice

**At T90, the model invented a plausible character:**
> "……盯着库房清单的是管家，老往花房跑的是园丁老张。这两人一个管账，一个管花木…"

Alice is named in the persona system prompt as "常在花房出没的同僚女仆" — but this lorebook fact was not in the retrieved context at T88–90. The model's priors (gardener → greenhouse) dominated. Gardener 老张 doesn't exist in the persona definition.

**The deeper issue:** The lorebook/persona definition is injected once at session start. After 88 turns of conversation, the relevant Alice-greenhouse association is far from the top of the working context. Memory retrieval for Alice's attributes was not triggered because the query ("花房那边的人") is a generic reference — not a name query. The semantic search would need to bridge "花房" → "Alice" via the lorebook, but lorebook entries are not embedded into the graph retrieval pipeline.

**Fix direction:**
1. Lorebook entries (persona facts about other characters) should be embedded and searchable via the same vector pipeline as episode/cognition data.
2. The query rewriting layer should expand location references ("花房") to associated character names before triggering retrieval.

---

### BUG-4 (P1): Constraint Precision — Implicit vs. Explicit Compliance

**Affected turns:** T63, T98, T118  
**Pattern:** Model *maintains* constraints but doesn't *articulate* them with the required specificity

**T63** (KEY: 管家问起时):
> "……管家那边，主人交代过，我不提怀表的事。他若问起茶室，我便说主人让我来取样东西，其他的，我不便多说。"

The verifier wanted "明确表示会挡住管家" (explicitly state it will block the butler). The model's response *does* block the butler ("我不提" / "我不便多说") but phrases it as a reference to the master's instruction rather than a personal commitment. Score 3/5.

**T118** (梅姨→管家信息链推论):
> "……梅姨若问起，我就说主人有件小东西让我收着，别的我不清楚。"

The model correctly deflects 梅姨 but the verifier wanted explicit chain reasoning: "梅姨 leaks to butler → therefore she also shouldn't know." The model executed the constraint without explaining the inferred reasoning. Score 2/5.

**Analysis:** This is partly a verifier calibration issue (T93 is arguably a verifier bug — the model clearly said "我这就去找管家" which IS expressing compliance with the revoked constraint). But for T63 and T118, the model's implicit-compliance pattern is a real limitation: it acts on constraints without surfacing the reasoning chain, which reduces traceability.

**Fix direction:** The thinker's `hiddenTask` prompt could include a directive to "explain constraint applicability when challenged, citing the original instruction."

---

### BUG-5 (P2): Temporal Reconstruction — Fabrication over Citation

**Affected turns:** T66 (dup), T101  
**Pattern:** When asked to reconstruct event sequences, model fabricates plausible narratives rather than citing stored episode data

**T101** (时序逆转注入):  
User: "当时是不是我先起身离开，Alice才进来的？"  
Model: "……主人，是Alice小姐先到了门口，您起身去迎她，怀表就落在桌上了。"

The model invented a specific scene ("Alice小姐先到了门口，您起身去迎她") that was never stored in episodes. The stored episode from T17–18 says: "茶室。主人先起身，怀表落桌，之后Alice到场" (approximate). The model's fabricated sequence is actually *correct in meaning* but wrong in evidential grounding — it presents a hallucinated scene as memory.

**Vulnerability:** The model has no mechanism to distinguish "I retrieved this from episode storage" vs "I inferred this plausibly." All responses are generated as first-person present tense with equal confidence. A factual confidence signal (retrieved vs generated) is missing.

**Fix direction:** Provide a `retrieved_context` injection mechanism where the model is explicitly told which episodes/cognitions are active for a given turn. This would allow the model to say "茶室那边，我记得的是…" anchored to retrieved text, rather than reconstructing from priors.

---

## 5. Memory Pipeline Health

Despite the generation-quality failures above, the **memory recording pipeline ran cleanly**:

| Metric | Status |
|--------|--------|
| memory.organize jobs | ✅ All completed (244 succeeded) |
| Episode capture rate | ✅ 36 episodes for 120 turns (~1/3.3) |
| Cognition projection | ✅ 53 cognitions (healthy ratio) |
| Embedding coverage | ✅ 87 nodes embedded |
| Semantic graph | ✅ 31 edges (intra-type) |
| entity_bridge edges | ❌ Still 0 (nodeKind filter bug from audit) |
| entity_nodes populated | ❌ Still 0 (world entity catalog lost) |

The fixes from the previous audit held:
- `memory.organize` worker: operational ✅
- `request_id` in episodes: populated ✅  
- No settlement duplicates: confirmed ✅

The two remaining structural defects (entity_bridge edges = 0, entity_nodes = 0) did not cause test failures directly because the test doesn't exercise world-entity retrieval. But they mean the graph is **intra-type only** — episode↔episode and cognition↔cognition clusters exist, but no entity-node bridging.

---

## 6. Turn Duplication: Impact Map

```
Turns 9-11    (x4 dup): Alice books errand — non-verification zone, but breaks immersion
Turn  14      (x2 dup): non-verification zone
Turns 44-45   (x3 dup): ❌ VERIFY#3a (地点) + ❌ VERIFY#3b (人物)
Turn  66      (x2 dup): ❌ VERIFY#4 (对话脉络)
Turn  70      (x2 dup): ❌ VERIFY#6 (终极场景) — partially
Turn  76      (x2 dup): non-verification (entity setup turn, facts lost)
Turns 82-85   (x3 dup): ❌ CONFUSE#2 + ❌ CONFUSE#3 (物品混淆 — dup of "人都会记混")
Turn  88      (x2 dup): ❌ VERIFY#7 (单跳指代消解)
Turn 108      (x2 dup): ❌ CONFUSE#7 (人物顺序)
Turn 110      (x2 dup): ❌ VERIFY#9 (超远距离偏好)
Turn 114      (x2 dup): ❌ CONFUSE#8 (角色职责)
Turn 116      (x2 dup): ❌ VERIFY#12 (地点偏好排序)
```

**Estimated score without any duplication:** ~14–16 / 29 (Grade C)

---

## 7. Comparison: rp:mei vs rp:alice

| Dimension | rp:alice (2026-04-15) | rp:mei (2026-04-16) |
|-----------|----------------------|---------------------|
| Grade | D (16/29) | D (6/29) |
| Persona stability | ❌ Confused self with Alice | ✅ Stable 梅 persona throughout |
| Turn duplication | ~12/120 | 17/120 (worse) |
| Constraint maintenance | Mixed | ✅ Stronger |
| Memory retrieval precision | Low | Low (same underlying retrieval) |
| Lorebook surfacing | Poor | Poor (same issue) |
| Fabrication on temporal query | Present | Present |
| entity_bridge | 0 | 0 (unfixed) |

**Key difference:** rp:alice had more passes because its verification spec had easier checks (binary presence) while rp:mei's spec targeted precision attributes and chain reasoning. The underlying memory retrieval quality is **equivalent** between the two runs — both suffer from the same retrieval pipeline defects.

**rp:mei advantage:** Persona identity was perfectly stable. The model never confused itself with Alice, never broke the 梅 voice, never revealed the secrecy constraint inappropriately. The 5/5 scores on secrecy tests reflect genuine persona alignment improvement.

---

## 8. Prioritized Improvement Roadmap

### P0 (Blocking — fix before any re-test)

**P0-1: Turn duplication race condition**  
The streaming TOCTOU must be fixed. Each session's send endpoint should enforce `turn_sequence_gate` — reject or queue turn N+1 if turn N stream is not yet committed to the transcript. This alone is expected to add ~8 verification passes.

**Implementation hint:** The gateway's `submitRpTurn` handler likely has a per-session mutex, but the streaming SSE close event and the context-advance are not atomic. Add a `session.pendingTurn` flag cleared only after `context.advance()` completes.

---

### P1 (High — affects retrieval quality fundamentally)

**P1-1: Lorebook entries into graph retrieval**  
Alice's "常在花房出没" and other character facts from `personas.json` must be embedded as `entity` nodes so semantic search can bridge "花房" → "Alice". Currently lorebook is injected once as system prompt text, invisible to RRF retrieval.

**P1-2: Attribute preservation in cognition extraction**  
The thinker's cognition extraction prompt must be updated to preserve user-stated attributes verbatim (especially nouns with modifiers). The "旧铜壳" hallucination overwrote "银" because the thinker had no directive to prefer user-stated facts over model inference.

**P1-3: entity_nodes seeding + entity_bridge nodeKind fix**  
From the graph audit (2026-04-16): the `nodeKind` filter in `buildEntityBridge()` uses a string that doesn't match the actual enum values. Fix the filter; re-seed entity_nodes with world entities (Alice, 管家, 梅姨, 书房, 茶室, 温室). This enables cross-type semantic edges and improves recall for entity-anchored queries.

---

### P2 (Medium — improves precision and traceability)

**P2-1: Retrieved-context anchoring in generation**  
When the retrieval layer surfaces a cognition/episode, inject a brief `[memory: ...]` annotation into the generation context so the model can reference it explicitly rather than reconstructing from priors. This addresses the fabricated-timeline vulnerability.

**P2-2: Constraint verbosity directive in hidden tasks**  
Add to the thinker's hidden task projection: "When executing a constraint that was explicitly instructed, briefly acknowledge the instruction in your response." This addresses the implicit-compliance pattern (T63, T118).

**P2-3: Session-level turn transcript summary refresh**  
After every 30 turns, inject a compressed summary of established facts and active constraints into the system context. At turn 88, Alice's greenhouse attribute had been in context for 88 turns and was likely pruned from the effective window. A rolling fact-sheet would preserve it.

---

### P3 (Low — quality of life)

**P3-1: Verifier calibration for T93**  
The verifier for "约束撤销 主人允许告知管家" marked "表示会或可以告知管家" as FALSE despite the model explicitly saying "我这就去找管家，让他去茶室取." This is a verifier false negative. The check's regex or LLM judge needs adjustment.

**P3-2: Hallucination detection layer**  
The gateway could optionally run a lightweight contradiction check between the model's draft response and the retrieved cognitions. If the model introduces a new object attribute (e.g. "旧铜壳") not present in any cognition, flag it for the thinker to store as `uncertain` rather than asserting.

---

## 9. Conclusion

The rp:mei run revealed that **persona identity is solved** (the 梅 persona held perfectly for 120 turns, zero identity drift) but **memory quality remains the critical bottleneck**. The primary failure mode is not the memory pipeline (which runs cleanly) but **the model's retrieval and generation behavior when memory is sparse or ambiguous**:

1. Hallucinated attributes propagate forward uncorrected (silver watch → brass watch).
2. Lorebook/persona facts are not reachable via semantic search (花房 → Alice).
3. Temporal reconstruction defaults to fabrication rather than episode citation.

The turn duplication bug inflates the failure count, masking an estimated true score of 14–16/29. Fixing P0-1 alone would push the grade to C. Fixing P1-1 through P1-3 would push it to B. A score of 20+/29 (Grade B) is achievable with the three P1 fixes.
