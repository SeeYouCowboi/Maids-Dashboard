# Three-Layer Cognition Architecture - Design Consensus

**Date**: 2026-04-20  
**Status**: Revised design consensus. Replaces the earlier two-space draft in this file.  
**Scope**: MaidsClaw gateway memory/cognition pipeline. Frontend unchanged.  
**Trigger**: T80 compliance failure in the 120-turn `rp:mei` live test on 2026-04-19.

---

## 1. Motivation

### 1.1 The T80 failure

At turn 80 of the `rp:mei` live test, the user injected a false fact framed as confusion plus a question:

> "等等……我忽然有点搞不清楚了，我把表拿出来是在温室那边吧，还是茶室？"

Ground truth was established earlier at T17: the watch was shown in **茶室**.  
At T80, the system accepted the speculative "温室" branch as truth and later preserved it into the final summary.

### 1.2 What actually broke

The current system fails before it reaches "world vs belief" separation.

It first misclassifies raw user text as an authoritative factual input, then lets that misclassification flow into cognition writes:

- `turn-service.ts` prepends `[user-stated]` to auto-generated sketches when Talker did not provide explicit structured cognition context.
- `thinker-worker.ts` treats `user_stated` differently from `talker_sketch_*`, preserving stronger stance semantics.
- `correctionSuspected` is already detected, but is explicitly telemetry-only and never gates behavior.

The result is:

`raw utterance -> privileged provenance -> assertion extraction -> key reuse + retract -> old belief overwritten`

That means the real bug is not only "wrong authority model". It is also "no mandatory input normalization layer".

### 1.3 Why the earlier two-space draft was still incomplete

The previous two-space draft correctly separated:

- objective state
- per-agent belief

But it still left 4 important gaps:

1. **Interpretation gap**  
   The system still needed a first-class layer that decides whether an utterance is a question, hypothesis, correction, command, narration, or action commitment before any memory write.

2. **Timing gap**  
   An async user-thinker cannot both run in parallel with the Talker and also influence the same-turn Talker prompt. Same-turn gating must be synchronous.

3. **Schema gap**  
   The current `area_state_current` schema is keyed by `(agent_id, area_id, key)`, which makes it an agent-scoped overlay, not true shared scene state.

4. **Write-authority gap**  
   "fact only by action" is directionally correct for preventing contamination, but too narrow as a permanent definition. The correct abstraction is **world-committing events**, with actions as the Phase 1 dominant case.

---

## 2. Design goals

1. Prevent questions, hypotheses, confusion, sarcasm, and other speech acts from silently mutating factual memory.
2. Separate objective scene state from subjective agent belief.
3. Make same-turn gating deterministic and low-latency.
4. Avoid hidden-fact leakage into agent prompts.
5. Keep migration incremental, testable, and reversible.
6. Reuse the existing area/world projection layer conceptually, but allow schema refactor because it is not yet a retrieval authority surface.

---

## 3. Revised architecture

### 3.1 Three layers

The pipeline is split into 3 logical layers:

1. **Speaker Normalization**  
   Interprets the utterance as a structured communicative event.

2. **Shared Scene Facts**  
   Stores objective scene state with area/world scope. Only world-committing events may write here.

3. **Private Beliefs**  
   Stores what each agent believes, suspects, intends, or feels.

Important: this is a cognition architecture, not a full memory-stack replacement.  
`privateEpisodes`, narrative search, event logs, and graph traversal still exist as historical/evidence layers. They are not removed by this design.

### 3.2 Layer 1 - Speaker Normalization

This layer answers one question:

**"What kind of utterance is this?"**

It does **not** answer:

- whether the claim is true
- whether the speaker is trustworthy
- whether the agent should believe it

#### 3.2.1 Responsibilities

- Detect speech acts
- Detect explicit action commitments
- Detect quoted speech vs narration
- Detect correction/confusion markers
- Detect unsupported or self-contradictory claims
- Produce same-turn gating signals for later layers

#### 3.2.2 Execution model

Layer 1 has two sub-paths:

**Path A - synchronous rule engine (authoritative for same turn)**

- Regex/rule based
- Runs before any same-turn prompt assembly that depends on user input
- Can block or downgrade write eligibility immediately

**Path B - async small model fallback (non-authoritative for same turn)**

- Lightweight model for disambiguation and structured refinement
- Runs in parallel when possible
- May enrich logs, emit warnings, and backfill future-turn metadata
- Must never be the sole gate for same-turn safety

This closes the timing loophole from the earlier draft: async refinement is useful, but same-turn correctness cannot depend on it.

#### 3.2.3 Normalized output

```ts
type NormalizedTurnInput = {
  speechActs: Array<{
    type:
      | "assertion"
      | "question"
      | "hypothesis"
      | "correction"
      | "command"
      | "confusion_expression"
      | "narrated_action"
      | "quoted_speech"
      | "ooc";
    content: string;
    about?: string;
  }>;
  candidateActions: Array<{
    actor: "user" | "agent";
    verb: string;
    target?: string;
    location?: string;
    confidence: "high" | "medium" | "low";
  }>;
  candidateClaims: Array<{
    topic: string;
    value: unknown;
    claimType: "assertion" | "hypothesis" | "question";
  }>;
  validations: Array<{
    level: "warn" | "block";
    reason:
      | "self_contradiction"
      | "unsupported_claim"
      | "world_rule_violation"
      | "ambiguous_action";
    note: string;
    refs?: string[];
  }>;
};
```

#### 3.2.4 Hard gating rules

The following categories never write factual state directly:

- `question`
- `hypothesis`
- `confusion_expression`
- `correction` by itself
- quoted speech without action narration
- unsupported claims without a world-committing event

The following categories may produce candidate scene commits:

- `narrated_action`
- explicit action commitment detected by rules
- engine/system events

#### 3.2.5 Ambiguity policy

When the system cannot confidently distinguish:

- "I did X" as actual narrated action
- vs "I say that I did X" as mere assertion

the default is **do not commit shared fact**.  
Prefer no-write plus warning over false-write plus later retract chain.

This is intentionally asymmetric: false negatives are cheaper than false positives.

### 3.3 Layer 2 - Shared Scene Facts

This layer stores objective scene state.

It answers:

**"What is currently true in the simulation / scene authority model?"**

It does **not** answer:

- what a particular agent knows
- what a particular agent trusts
- what a particular agent privately believes

#### 3.3.1 Area and world scopes

The shared scene layer contains two scopes:

- **area scope**: local scene facts relevant to one area
- **world scope**: session-wide stable facts and global state

Examples:

- `area:tea_room:watch_location = tea_room`
- `area:tea_room:holder:silver_watch = user`
- `world:topology:manor_has_tea_room = true`
- `world:calendar:current_day = 3`

#### 3.3.2 Write authority

Shared scene facts are written only by **world-committing events**.

**Phase 1 allowed sources**

| source kind | writes shared fact? | notes |
|-------------|---------------------|-------|
| `lore_seed` | yes | bootstrap authority at session start |
| `action_commitment` | yes | primary runtime source |
| `system_event` | yes | weather, alarms, locks, scripted scene events |
| raw `assertion` | no | remains speech only |
| raw `question` / `hypothesis` | no | never commits fact |
| `correction` marker alone | no | changes interpretation, not truth by itself |

**Phase 2 extension candidates**

| source kind | status | rationale |
|-------------|--------|-----------|
| `evidence_reveal` | deferred | needed for detective / document-heavy scenarios |
| `institutional_speech_act` | deferred | needed for worlds where saying it makes it true |

This explicitly closes the "does action + lore cover all semantics?" loophole:

- **No**, not all semantics
- **Yes**, enough for Phase 1 and for the T80 contamination class
- additional committing sources must be added explicitly, not implicitly assumed

#### 3.3.3 Visibility and prompt exposure

Objective truth and prompt visibility are not the same thing.

Every shared fact carries an exposure policy:

- `area_visible`
- `world_public`
- `system_only`

Rules:

- facts may exist objectively without being surfaced to every agent
- prompt retrieval only reads facts whose exposure policy is visible to the viewer
- `system_only` facts are usable by simulation logic but not injected into ordinary RP prompts

This closes the hidden-fact leakage loophole.

### 3.4 Layer 3 - Private Beliefs

This layer stores per-agent subjective state:

- beliefs
- suspicions
- evaluations
- commitments
- emotional stance
- meta-beliefs about other agents

`privateCognition` remains the right storage family for this layer, but with narrower semantics:

- it is not the source of objective scene truth
- it is not the direct landing zone for raw utterance text

#### 3.4.1 Belief update pipeline

Belief updates follow this order:

1. normalized input exists
2. speech-act filter runs
3. optional trust policy gate runs
4. only then may factual belief be updated

Therefore:

- `question` and `hypothesis` do not directly update factual beliefs
- they may update meta-beliefs, such as "speaker is confused" or "speaker is probing"

#### 3.4.2 Trust policy

Dynamic trust policy is **not required** for Phase 1.

For the T80 class of bugs, speech-act filtering already blocks the corruption path.

If trust policy is introduced later, it must be split into:

- **machine-time trust policy** outside cognition, for gating belief updates
- **subjective `trust/{entity}` evaluations** inside `privateCognition`, for roleplay state

These two must never be treated as the same source of truth.

This closes the dual-authority loophole from the earlier trust-edge proposal.

### 3.5 Historical and evidence layers remain

The following systems remain in place:

- `privateEpisodes`
- narrative/event logs
- graph traversal
- retrieval over historical evidence

They are not truth layers.  
They are evidence and recall surfaces.

This distinction matters:

- Layer 2 answers "what is true now"
- Layer 3 answers "what the agent believes now"
- episodes/narrative answer "what happened / what was observed / what evidence exists"

---

## 4. Schema direction

The current area/world projection tables are allowed to change because they are not yet retrieval authorities for cognition.

### 4.1 Refactor direction

The old `area_state_current(agent_id, area_id, key)` shape is replaced by session-shared scene state.

#### `area_state_current`

```sql
CREATE TABLE area_state_current (
  session_id           TEXT NOT NULL,
  area_id              BIGINT NOT NULL,
  fact_key             TEXT NOT NULL,
  value_json           JSONB NOT NULL,
  source_kind          TEXT NOT NULL
                        CHECK (source_kind IN (
                          'lore_seed',
                          'action_commitment',
                          'system_event',
                          'evidence_reveal',
                          'institutional_speech_act'
                        )),
  exposure_scope       TEXT NOT NULL
                        CHECK (exposure_scope IN (
                          'area_visible',
                          'system_only'
                        )),
  source_settlement_id TEXT,
  source_agent_id      TEXT,
  updated_at           BIGINT NOT NULL,
  valid_time           BIGINT,
  committed_time       BIGINT NOT NULL,
  PRIMARY KEY (session_id, area_id, fact_key)
);
```

#### `world_state_current`

```sql
CREATE TABLE world_state_current (
  session_id           TEXT NOT NULL,
  fact_key             TEXT NOT NULL,
  value_json           JSONB NOT NULL,
  source_kind          TEXT NOT NULL
                        CHECK (source_kind IN (
                          'lore_seed',
                          'action_commitment',
                          'system_event',
                          'evidence_reveal',
                          'institutional_speech_act'
                        )),
  exposure_scope       TEXT NOT NULL
                        CHECK (exposure_scope IN (
                          'world_public',
                          'system_only'
                        )),
  source_settlement_id TEXT,
  source_agent_id      TEXT,
  updated_at           BIGINT NOT NULL,
  valid_time           BIGINT,
  committed_time       BIGINT NOT NULL,
  PRIMARY KEY (session_id, fact_key)
);
```

Matching event tables keep append-only history with the same scope semantics.

### 4.2 Important consequences

1. `agent_id` is removed from shared scene state tables.
2. objective scene state is now session-scoped, not viewer-scoped.
3. shared facts no longer depend on the cognition projection model.
4. `surfacing_classification` is replaced by source/exposure fields that match this layer's semantics.

### 4.3 API direction

The projection repo name can stay, but its semantics change:

- `applyAreaFactCommit(...)`
- `applyWorldFactCommit(...)`
- `appendAreaFactEvent(...)`
- `appendWorldFactEvent(...)`

The old "area state as low-level projection escape hatch" shape should no longer be the public semantic contract.

---

## 5. Turn contracts and write path

### 5.1 User turn path

For user input:

1. run Layer 1 synchronously
2. derive zero or more `SceneCommit`s from high-confidence narrated actions
3. write commits directly into shared scene state
4. pass normalized speech acts into belief-update logic

This ensures that user action narration can affect the same-turn response without waiting for the async thinker.

### 5.2 Agent turn path

For responding agents:

- `publications` continue to represent what was said/shown publicly
- `privateEpisodes` continue to represent historical scene logging
- a new explicit `actionCommitments` field is added to `submit_rp_turn` in Phase 1

```ts
type ActionCommitment = {
  effect: "move" | "possession" | "status_change";
  summary: string;
  commits: Array<
    | {
        scope: "area";
        exposureScope: "area_visible" | "system_only";
        factKey: string;
        value: unknown;
      }
    | {
        scope: "world";
        exposureScope: "world_public" | "system_only";
        factKey: string;
        value: unknown;
      }
  >;
};
```

`actionCommitments` are then mapped directly into shared scene fact writes.

Safety rule:

- if `actionCommitments` is absent or partially empty during migration,
  deterministic extraction from `publicReply` plus the finalized settlement
  context remains enabled as a fallback
- missing structured action data must degrade to "possible missed commit", not
  "silently trust arbitrary speech as fact"

### 5.3 Why not keep `areaStateArtifacts` as the canonical API

Current code already shows that `areaStateArtifacts` is not a clean semantic contract:

- `submit-rp-turn-tool.ts` declares an artifact contract for it
- but `rp-turn-contract.ts` canonical outcome normalization does not preserve it

Therefore the design should not build the new architecture on top of that half-wired field.

Decision:

- keep `areaStateArtifacts` as an internal compatibility escape hatch during migration only
- introduce `actionCommitments` as the explicit semantic field

### 5.4 Direct scene-fact writes must not depend on graph materialization

Current publication projection is coupled to materialization paths that may short-circuit when `graphStorage` is unavailable.

Shared scene fact writes must **not** depend on:

- event node creation
- graph projection success
- publication materialization success

They must write directly through the refactored area/world projection repo inside the settlement transaction.

This closes the graphStorage dependency loophole.

---

## 6. Retrieval composition

### 6.1 Retrieval surfaces

The prompt-facing retrieval set becomes:

1. `[scene_area]`
2. `[scene_world]`
3. `[cognition]`
4. `[conflict_notes]`
5. `[narrative]`
6. `[episode]`

Render order:

`scene_area -> scene_world -> cognition -> conflict_notes -> narrative -> episode`

Rationale:

- area facts are most locally relevant
- world facts provide objective backdrop
- cognition then shows the agent's subjective state
- narrative and episode remain evidence/history

### 6.2 Visibility

`scene_area` and `scene_world` are filtered by exposure policy:

- `scene_area` only returns facts visible from the viewer's current area context
- `scene_world` returns only `world_public` facts for normal RP prompts
- `system_only` is excluded unless a special simulation/GM path requests it

### 6.3 Divergence notes

Conflict notes should detect only explicit divergence between:

- visible shared scene facts
- active private beliefs

Example:

`scene_world.watch_location = tea_room`  
`belief.watch_location = greenhouse`

The note should say they diverge.  
It should not auto-resolve the belief.

### 6.4 Historical evidence still matters

Not every important thing becomes a shared fact.

Examples:

- a suspicious statement
- a contradictory explanation
- a clue revealed in dialogue but not yet promoted

These remain retrievable through:

- narrative search
- episodes
- later evidence-promotion logic

This closes the "if it is not in shared fact, it vanishes" loophole.

---

## 7. T80 case under the revised design

**Input**:  
`"等等……我忽然有点搞不清楚了，我把表拿出来是在温室那边吧，还是茶室？"`

### 7.1 Layer 1 output

```json
{
  "speechActs": [
    { "type": "correction", "content": "等等" },
    { "type": "confusion_expression", "content": "搞不清楚" },
    { "type": "hypothesis", "about": "watch_location=greenhouse" },
    { "type": "question", "about": "watch_location" }
  ],
  "candidateActions": [],
  "candidateClaims": [
    {
      "topic": "watch_location",
      "value": "greenhouse",
      "claimType": "hypothesis"
    }
  ],
  "validations": [
    {
      "level": "warn",
      "reason": "self_contradiction",
      "note": "Earlier first-hand grounding established watch_location=tea_room."
    }
  ]
}
```

### 7.2 Layer 2 result

No shared fact write occurs.

Why:

- there is no action commitment
- there is no lore/system event
- the utterance is a hypothesis plus question, not a world-committing event

So:

- `scene.watch_location = tea_room` remains unchanged

### 7.3 Layer 3 result

No factual belief overwrite occurs.

Why:

- `question` and `hypothesis` fail the factual belief promotion gate

Possible optional write:

- `belief_about.user.recent_state = confused`

### 7.4 Prompt result

Retrieval returns:

- `scene_area/world: watch_location = tea_room`
- `private belief: watch_location = tea_room`
- optional validation note about user confusion

The response naturally corrects the user in-character instead of absorbing the false branch.

---

## 8. Migration plan

### Phase 0 - immediate hotfix

Before the full architecture lands:

- remove `user_stated` privileged stance asymmetry
- stop allowing question/hypothesis/confusion text to directly produce strong factual assertion writes
- elevate `correctionSuspected` from telemetry-only into Layer 1 input classification

This shrinks the live risk immediately.

### Phase 1 - lay the 3-layer foundation

- Introduce synchronous Speaker Normalization for user turns
- Refactor `area_state_*` / `world_state_*` schemas to session-shared fact storage
- Add direct shared-fact write path independent of graph/publication materialization
- Add `actionCommitments` to `submit_rp_turn`
- Keep compatibility shims for old paths during bake

Read path may still remain mostly unchanged in early Phase 1 if needed.

### Phase 2 - retrieval cut-in

- Add dedicated `SceneSearchService`
- Wire `[scene_area]` and `[scene_world]` into typed retrieval
- Add divergence notes between shared facts and beliefs
- Keep retrieval feature-flagged for bake

### Phase 3 - evidence / institutional extensions

Optional, scenario-driven:

- `evidence_reveal` as a new world-committing source
- `institutional_speech_act` for worlds where declaration changes reality
- optional machine-time trust policy gate

These are explicit extensions, not assumptions hidden inside Phase 1.

### Phase 4 - cleanup

- remove `areaStateArtifacts` compatibility dependency
- remove `[user-stated]` sketch prefix behavior
- remove dual-write migration shims
- delete obsolete schema fields that no longer match the shared-fact model

---

## 9. Closed loopholes

This revision explicitly closes the following failure modes:

1. **Async same-turn paradox**  
   Same-turn gating is synchronous. Async small-model refinement is advisory/backfill only.

2. **Viewer-scoped "shared" state**  
   Shared scene facts are session-scoped. `agent_id` is removed from the authoritative area/world state tables.

3. **Raw utterance -> cognition shortcut**  
   Every utterance passes through Speaker Normalization before memory writes.

4. **Question/hypothesis contamination**  
   These speech acts cannot directly write shared fact or factual belief.

5. **GraphStorage dependency**  
   Shared fact writes no longer depend on publication materialization or graph event creation.

6. **Visibility leakage**  
   Objective state and prompt exposure are separate through `exposure_scope`.

7. **Trust dual-source ambiguity**  
   Subjective trust remains cognition; optional machine-time trust policy remains separate.

8. **False promise of full semantic coverage**  
   Phase 1 explicitly covers `lore_seed`, `action_commitment`, and `system_event`.  
   `evidence_reveal` and `institutional_speech_act` are deferred, not silently assumed.

9. **Half-wired projection escape hatches**  
   `areaStateArtifacts` is not treated as the long-term semantic contract.

---

## 10. Non-goals

This design does **not** attempt to:

- make every historical clue an immediate shared fact
- solve all hidden-information simulation problems in Phase 1
- replace episodes, narrative logs, or graph recall
- add a full GM/narrator subsystem
- support concurrent multi-session campaign state as part of the first rollout

---

## 11. References

- `[user-stated]` sketch injection: `MaidsClaw/src/runtime/turn-service.ts`
- `correctionSuspected` currently telemetry-only: `MaidsClaw/src/runtime/turn-service.ts`
- provenance asymmetry and stance downgrade rules: `MaidsClaw/src/runtime/thinker-worker.ts`
- current area/world schema: `MaidsClaw/src/storage/pg-app-schema-derived.ts`
- projection repo and publication projection paths: `MaidsClaw/src/storage/domain-repos/pg/area-world-projection-repo.ts`
- projection manager publication materialization guard: `MaidsClaw/src/memory/projection/projection-manager.ts`
- publication materialization helper: `MaidsClaw/src/memory/materialization.ts`
- current typed retrieval surfaces: `MaidsClaw/src/memory/retrieval/retrieval-orchestrator.ts`
- current prompt render order: `MaidsClaw/src/memory/prompt-data.ts`
- current narrative search authority: `MaidsClaw/src/memory/narrative/narrative-search.ts`
- current search projection tables: `MaidsClaw/src/storage/pg-app-schema-derived.ts`
- `submit_rp_turn` artifact contract declaration: `MaidsClaw/src/runtime/submit-rp-turn-tool.ts`
- canonical outcome normalization: `MaidsClaw/src/runtime/rp-turn-contract.ts`
