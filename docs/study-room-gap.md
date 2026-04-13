# Study Room — 需求与 Gap 全景文档

> 生成时间：2026-04-13
> 参考基线：`docs/refactor-consensus.md` §7.2 / §7.3 / §11.3（Study Room 定义）
> 受众：执行者。本文档自带所有必要的上下文，不需先读其它背景文档即可开始落地。

---

## 0. 文档目的

`refactor-consensus.md` 已经在架构层面把 Study Room 定义为 **RP agent 持久化记忆的 debug 驾驶舱**，并在 §7.3 列出了所需的 7 条 gateway 路由、在 §11.3 给出了默认布局。本文档要回答的问题是：

- **现在（2026-04-13）**Study Room 真实可用到什么程度？
- **到"可以 debug 一次 RP turn 的生成与检索"**还差多少？差距是代码缺失、数据未产生、还是入口未连通？
- 每个差距对应哪些**具体文件、具体函数**，应该以什么顺序修复？

这份文档的目标是让执行者拿着它**直接开工**——无需再反向追溯代码。

---

## 1. 用户故事（Why）

Dashboard 的唯一用户（项目主人）在做 RP agent 调优时，需要回答下面这些问题。注意下面 13 行里只有 2 行今天能真正回答清楚——其它要么断点、要么路由缺失。

### 1.1 已经部分打通的问题

| 问题 | 现在如何回答 | 期望的回答路径 | 今天状态 |
|---|---|---|---|
| Alice 这一轮到底"记住了"什么公共事件？ | 翻 PG 表 / 读日志 | Study → Alice → Episodes | ✅ 能回答 |
| 这次结算（settlement）有没有失败？ | 看 PG 表 | Study → Alice → Settlements | ✅ 能回答 |
| Alice 的 persona / knowledge 核心块长啥样？ | 看 `config/personas.json` | Study → Alice → Core Blocks | ⚠️ 路由通，数据空 |
| 世界 / 区域的叙事状态是什么？ | 无路径 | Study → Alice → Narratives | ⚠️ 路由通，数据空 |
| Alice 这一轮"查"了什么记忆？查到了没有？ | 翻 trace-store 内存日志 | Study → Alice → Retrieval Trace | ⚠️ 路由通，无入口 |

### 1.2 **完全无法回答的问题**（本轮补充）

这组问题涉及 MaidsClaw 记忆系统里的 **cognition（认知 / 私密思维）** 和 **graph memory（事件图谱）** 两个子系统。它们既是"持久化记忆生成"的主要产物，又是 RP agent debug 时最需要看的东西，**但目前 gateway 没有任何一条路由能取到它们**。

| 问题 | 对应子系统 | 今天状态 |
|---|---|---|
| Alice 这一轮形成了什么**私密信念（assertion）**？比如"主人喜欢红茶" | Cognition | ❌ 无路由 |
| Alice 这一轮对某件事 / 某个人的**情绪评价（evaluation）**是什么？ | Cognition | ❌ 无路由 |
| Alice 当前有哪些**目标 / 意图 / 承诺（commitment）**？状态是 active / paused / fulfilled 哪种？ | Cognition | ❌ 无路由 |
| 刚才那条信念经历了 hypothetical → tentative → accepted 哪几个 stance 转变？有没有被 contested / rejected？ | Cognition（带 ledger 轨迹） | ❌ 无路由 |
| 这一 turn 产生了哪些 **event node**？它们之间有什么 **causal / contradict / reinforce** 边？ | Graph memory | ❌ 无路由 |
| Navigator 这次 beam search 走了哪些节点？为什么走到了"红茶偏好"这条边？ | Graph memory + 检索 trace | ❌ 无路由 |
| 两个 belief 之间是不是有 `conflict_or_update` 语义边？是系统自动识别的还是手写的？ | Graph memory / semantic edges | ❌ 无路由 |
| 这一 turn 之后，entity "管家" 的中心度 / salience 有没有变化？ | Graph memory / node_scores | ❌ 无路由 |

驾驶舱的承诺：**上面所有 13 个问题都应该能在 Study Room 三次点击之内回答清楚**。今天能真正回答的是 2 个，剩下 11 个都有不同程度的断点。

---

## 2. 架构速查（Where the data lives）

这张表把"用户看到的每个 facet"反向追到真正的数据源与写入路径。是后续所有 gap 分析的共同基座。

### 2.1 前端数据源（Dashboard）

| Facet | 查询 | API 客户端 | Query Key |
|---|---|---|---|
| Core Blocks | `GET /v1/agents/{id}/memory/core-blocks` | `src/api/memory.ts::listCoreMemoryBlocks` | `queryKeys.memory.coreBlocks(agentId)` |
| Episodes | `GET /v1/agents/{id}/memory/episodes` | `src/api/memory.ts::listEpisodes` | `queryKeys.memory.episodes(agentId)` |
| Narratives | `GET /v1/agents/{id}/memory/narratives` | `src/api/memory.ts::listNarratives` | `queryKeys.memory.narratives(agentId)` |
| Settlements | `GET /v1/agents/{id}/memory/settlements` | `src/api/memory.ts::listSettlements` | `queryKeys.memory.settlements(agentId)` |
| Pinned Summaries | `GET /v1/agents/{id}/memory/pinned-summaries` | `src/api/memory.ts::listPinnedSummaries` | `queryKeys.memory.pinnedSummaries(agentId)` |
| Retrieval Trace | `GET /v1/requests/{id}/retrieval-trace` | `src/api/requests.ts::getRetrievalTrace` | `queryKeys.requests.retrievalTrace(requestId)` |

渲染组件：`src/pages/StudyPage.tsx`，按 `FacetContent` 分派。左栏 agent 列表来自 `src/api/agents.ts::listAgents`。

### 2.2 后端实现（MaidsClaw）

| Facet 路由 | Controller | 依赖的服务 | 背后的存储 |
|---|---|---|---|
| `core-blocks`, `core-blocks/{label}` | `handleListCoreMemoryBlocks` / `handleGetCoreMemoryBlock` | `ctx.coreMemory` (`src/memory/core-memory.ts::CoreMemoryService`) | `CoreMemoryBlockRepo`（PG 表 `core_memory_blocks`） |
| `pinned-summaries` | `handleListPinnedSummaries` | 同 coreMemory | **同一张表**，只是 handler 里把 `label === 'pinned_summary' \|\| 'persona'` 过滤出来——**不是独立实体** |
| `episodes` | `handleAgentMemoryEpisodes` | `ctx.episodeRepo` (`src/memory/episode/`) | PG `episode_records` |
| `narratives` | `handleAgentMemoryNarratives` | `ctx.narrativeRepo` (`src/memory/projection/area-world-projection-repo.ts`) | PG `area_world_projections` |
| `settlements` | `handleAgentMemorySettlements` | `ctx.settlementRepo` | PG `settlement_processing_ledger` |
| `retrieval-trace` | `handleRequestRetrievalTrace` | `ctx.traceStore` (`src/app/diagnostics/trace-store.ts`) | **内存 bundle + 磁盘 `traceDir` 写入** |

所有 7 条路由在 `src/gateway/routes/memory.ts` 和 `src/gateway/routes/requests.ts` 中通过 `RouteEntry` 形式注册，并已挂入 `src/gateway/routes/index.ts::ROUTES`。

### 2.3 数据写入路径（谁在什么时候产生数据）

| 数据 | 写入时机 | 写入方 |
|---|---|---|
| Episodes | turn 结算时 | `src/memory/explicit-settlement-processor.ts`、`src/memory/cognition-op-committer.ts` |
| Settlements | turn 开始 → 结算 | `src/memory/settlement-ledger.ts` |
| Narratives | 叙事合并阶段 | `src/memory/projection/area-world-projection-repo.ts` |
| Core Blocks | `coreMemory.initializeBlocks(agentId)` 被显式调用时 + `appendBlock` / `replaceBlock` 调用时 | 没有"turn 自动写入"的路径，需要代码主动触发 |
| Pinned Summaries | 同 Core Blocks（filter 视图） | 同上 |
| Retrieval Trace | 每次 turn 的 prompt 构建时 | `src/core/prompt-data-sources.ts::onRetrievalTraceCapture` → `traceStore.setRetrieval()` |

**关键观察**：Core Blocks 和 Pinned Summaries 没有被 turn 自动写入。它们依赖调用方主动 `initializeBlocks` 或使用 `memory.append` / `memory.replace` 工具调用。今天 `rp:alice` 在实际对话中**没有任何调用路径**触发 core block 写入，所以 `GET /v1/agents/rp:alice/memory/core-blocks` 返回 `{"blocks":[]}` 不是 bug，是"RP agent 不使用 core memory"的事实暴露。

### 2.4 Cognition 子系统（未暴露）

Cognition 是 RP agent 在一次 turn 里形成的**私密认知产物**——它不是公共事件（episodes 是），而是 agent 头脑里的信念 / 情绪 / 目标状态。

**数据模型**（`D:\Projects\MaidsClaw\src\memory\cognition\` + `src/contracts/`）：

| 类型 | 字段要点 |
|---|---|
| **AssertionRecordV4** | `kind`, `key`, `holderId`, `claim`, `entityRefs[]`, `stance`, `basis?`, `preContestedStance?`, `salience?` |
| **EvaluationRecord** | `kind`, `key`, `target`, `dimensions[]`, `emotionTags?`, `notes?`, `salience?` |
| **CommitmentRecord** | `kind`, `key`, `mode`, `target`, `status`, `priority?`, `horizon?`, `salience?` |

- **Stance 状态机**：`hypothetical → tentative → accepted → confirmed` / `contested` / `rejected` / `abandoned`
- **Basis（信念来源）**：`first_hand` / `hearsay` / `inference` / `introspection` / `belief`
- **Commitment mode**：`goal` / `intent` / `plan` / `constraint` / `avoidance`；**status**：`active` / `paused` / `fulfilled` / `abandoned`

**存储**：
- 源头（append-only ledger）：PG 表 `private_cognition_events`
  - 列：`id`、`agent_id`、`cognition_key`、`kind`、`op`、`record_json`、`settlement_id`、`committed_time`、`created_at`
  - 索引：`(agent_id, cognition_key, committed_time)`、`(settlement_id)`
- 投影视图：`CognitionProjectionRepo`（`src/storage/domain-repos/pg/cognition-projection-repo.ts`）——"当前最新"状态
- Prompt cache：`recent_cognition_slots` 表（session-scoped，最多 64 条，供 prompt 快速注入）

**写入路径**：
1. `src/runtime/thinker-worker.ts`：Thinker 在 turn outcome 阶段产出 `privateCognition.ops[]`（`PrivateCognitionCommitV4`）
2. `src/memory/explicit-settlement-processor.ts`（约 line 170）：settlement 处理时调用 `commitCognitionOps()`
3. `src/memory/cognition/cognition-repo.ts`：`upsertAssertion()` / `upsertEvaluation()` / `upsertCommitment()` / `retractCognition()`
4. `src/storage/domain-repos/pg/cognition-event-repo.ts`：写入 `private_cognition_events`（按 `(settlement_id, agent_id, cognition_key, op)` 去重）

**读取路径**（已存在但**未被 gateway 暴露**）：
- `CognitionRepository.getAssertions() / getEvaluations() / getCommitments() / getAssertionByKey()`
- `CognitionProjectionRepo` 投影查询
- `RecentCognitionSlotRepo` 快速 slot 读取
- `src/app/inspect/inspect-query-service.ts` 里有内部 debug 入口（`unsafeRaw` 模式），但**不走 gateway**

**Gateway 暴露**：**零**。`src/gateway/routes/memory.ts` 没有任何 cognition 路由。

**Dashboard 消费**：**零**。`src/api/memory.ts` 没有 cognition 相关函数。

**与 episodes 的区别**：

| 维度 | Cognition | Episodes |
|---|---|---|
| 可见性 | Agent 私密 | 混合（私密笔记 + 公共事件） |
| 内容 | 信念 / 评价 / 承诺（状态机） | Turn artifacts（speech / action / observation） |
| 持久化 | Event-sourced ledger + 投影 | Fact edges + 叙事段 |
| Gateway | ❌ | ✅ `/memory/episodes` |
| 生命周期 | Upsert / retract 任意次 | 一次 settlement 写一次 |
| Debug 价值 | **Agent 为什么这么说 / 这么想** | **Agent 说了 / 做了什么** |

### 2.5 Graph Memory 子系统（未暴露）

Graph memory 是 MaidsClaw 的**跨事件关系矩阵**——事件节点是点，语义 / 逻辑 / 实体关联是边。Navigator 在检索时实际就是在这张图上做 beam search。

**数据模型**（`D:\Projects\MaidsClaw\src\memory\graph-organizer.ts` / `graph-edge-view.ts` / `navigator.ts`）：

| 表 | 关键列 | 类型 / 用途 |
|---|---|---|
| `event_nodes` | `id`, `session_id`, `timestamp`, `raw_text`, `summary`, `participants`, `emotion`, `topic_id`, `event_category`（speech/action/observation/state_change）, `visibility_scope`（area_visible / world_public）, `location_entity_id`, `primary_actor_entity_id`, `promotion_class`, `event_origin` | 事件主表 |
| `logic_edges` | `source_event_id`, `target_event_id`, `relation_type`, `weight`, `created_at` | 逻辑 / 时序边 |
| `semantic_edges` | `source`, `target`, `relation_type`, `weight`, `created_at` | 语义推理边 |
| `memory_relations` | 事件↔实体 / 事件↔事实 / 事实↔事实 等跨类型关系 | 异构关系 |
| `node_embeddings` | `node_ref`, `node_kind`, `view_type`（primary / keywords / context）, `model_id`, `vector`（pgvector） | HNSW 索引 |
| `node_scores` | `node_ref`, `salience`, `centrality`, `bridge_score`, `updated_at` | 节点评分 |

**边类型**：
- **Logic**：`causal` / `contradict` / `reinforce` / `temporal_prev` / `temporal_next` / `same_episode`
- **Semantic**：`semantic_similar` / `conflict_or_update` / `entity_bridge`
- **Memory relations**：`supports` / `triggered` / `conflicts_with` / `derived_from` / `supersedes` / `surfaced_as` / `published_as` / `resolved_by` / `downgraded_by`

**写入路径**（两阶段）：
1. **Turn flush 同步阶段**（`MemoryFlushRequest` → `MemoryTaskAgent.runMigrateInternal`）：
   - `createProjectedEvent()` / `createPromotedEvent()` → INSERT `event_nodes`
   - `createLogicEdge()` → INSERT `logic_edges`（temporal chain、causal、same-episode）
   - `RelationBuilder` → INSERT `memory_relations`
2. **异步 GraphOrganizer job**（`src/memory/graph-organizer.ts`）：
   - 嵌入每个变更节点的内容 → `node_embeddings`
   - 找语义邻居（相似度阈值 0.78–0.9）
   - 写 `semantic_edges`
   - 重算 `salience` / `centrality` / `bridge_score` → `node_scores`
   - 同步 search projection

**读取路径**（内部 only）：
- `src/memory/navigator.ts`：**Beam search** — 10 个 seed、宽度 8、深度 2、最多 12 候选；按 NodeRef 类型（event / entity / fact / assertion / evaluation / commitment）做 frontier 扩展
- `src/memory/graph-edge-view.ts`：
  - `readLogicEdges(frontier, viewerContext, timeSlice?)`
  - `readMemoryRelations(frontier, viewerContext, timeSlice?)`
  - `readSemanticEdges(frontier, viewerContext, timeSlice?)`
  - `readStateFactEdges(frontier, viewerContext, timeSlice?)`

**Gateway 暴露**：**零**。既没有 `/memory/graph` 也没有 `/memory/navigator-trace`。所有图谱数据对 Dashboard 完全不可见。

**Dashboard 消费**：**零**。`grep -r "graph\|eventNode\|event_node"` 在 `src/` 下零匹配。

**规模感**（每次 turn flush 粗估）：
- ~1–5 个新 event node
- ~3–10 条 logic edge
- ~0.5–2 条 semantic edge / event（organizer 执行后）
- ~200 entity 上下文被加载
- ~150 assertion + 50 commitment 被切片

**Per-agent vs shared**：混合。私密事件（如私密观察）agent-local；`world_public` 事件全局可见；entity 按 `owner_agent_id`（私密）或 `shared_public` 区分。

**与 episodes 的区别**：
- Episodes 回答"**发生了什么**"（per-agent 叙事片段）
- Graph 回答"**为什么相关 / 怎么连起来的**"（跨事件结构查询）

---

## 3. 实况快照（2026-04-13）

以下数据为实时测试抓取（见 `e2e/study-room-survey.spec.ts` 生成的截图 `e2e/screenshots/study-*.png`）。

### 3.1 `rp:alice` 各 facet 状态

| Facet | HTTP | 实际返回 | UI 渲染 | 备注 |
|---|---|---|---|---|
| core-blocks | 200 | `{"blocks":[]}` | "No core memory blocks" | **数据空**。所有 agent 都空（`maid:main` 也返回 `{"blocks":[]}`），不是 rp:alice 特有。 |
| episodes | 200 | 2 条（observation / speech，来自 Phase 1 E2E 测试的那次 turn） | 列表 + 类别 badge + 时间戳 + settlement_id 前缀 | **OK** |
| narratives | 200 | `{"agent_id":"rp:alice","items":[]}` | "No narratives." | 数据空（当前 turn 不涉及 area/world projection） |
| settlements | 200 | 1 条 `applied` | 状态 + attempts + claimed/applied 时间 | **OK** |
| pinned-summaries | 200 | `{"summaries":[]}` | "No pinned summaries." | 依赖 core-blocks 的 filter 结果，必然空 |
| retrieval-trace | 404 / "Navigate here..." | 需要 `?request_id=`，否则 UI 显示"Navigate here from a request in War Room or Grand Hall" | **无入口**。`/v1/logs?limit=5` 也返回 `{"entries":[]}`，连"最近有哪些 request"都无法列 |

### 3.2 `maid:main`（对照组）

- core-blocks / pinned-summaries 同样空
- 其它 facet 表现相同

### 3.3 Cognition 可观察性：零

| 检查项 | 结果 |
|---|---|
| gateway 路由 | ❌ 无 |
| `GET /v1/agents/rp:alice/cognition/assertions` | 404 Not Found |
| Dashboard `src/api/` 里有 cognition client 吗？ | ❌ 无 |
| Study Room 有 cognition facet 吗？ | ❌ 无 |
| `private_cognition_events` 表里有数据吗？ | **✓ 有**（Phase 1 测试的 turn 写入了），但外部拿不到 |

### 3.4 Graph memory 可观察性：零

| 检查项 | 结果 |
|---|---|
| gateway 路由 | ❌ 无 |
| `GET /v1/agents/rp:alice/graph/nodes` 等 | 404 Not Found |
| Dashboard 有 graph client 吗？ | ❌ 无 |
| Study Room 有 graph facet 吗？ | ❌ 无 |
| `event_nodes` / `logic_edges` / `semantic_edges` 表里有数据吗？ | **✓ 有**（Phase 1 测试写入），但外部拿不到 |
| Navigator beam search 日志保存到哪里？ | Trace store 里**没有 navigator 字段**——只有 `narrative_facets_used` / `cognition_facets_used` / `segment_count` 这几个 query-plan 级别的计数 |

**结论**：前后端 Study Room 对 episodes / narratives / settlements / core-blocks / pinned-summaries / retrieval-trace **6 个 facet** 已经打通（部分空数据是生成路径问题）。但 RP agent 记忆系统里**真正承载"Alice 为什么这么想 / 这么说"的两块数据（cognition + graph）完全没有任何可观察入口**。这是本文档第一版的重大遗漏。

---

## 4. Gap 分类

把差距按**根因**切成 4 个互斥类别。每个 gap 在后面的第 5 节都会对应到一个编号的工作项。

### 4.1 Connectivity Gap（入口 / 跨 Room 跳转）

前端代码已经能消费 7 条路由的返回，但**没有合理的入口让用户到达目标 facet**。

- **C-1 Retrieval Trace 是孤岛**：`/study/:agentId/retrieval-trace?request_id=...` 要 request_id，但当前 Dashboard 没有任何界面暴露 request_id。用户 literally 没办法进到这个 facet 看数据。
- **C-2 Session detail → Study 无跳转**：在 `src/pages/GrandHallSessionPage.tsx` 的 transcript 条目上，看完一条 assistant 消息后没有"🔍 看这次检索了什么记忆"的按钮。
- **C-3 Study 内部 agent 列表混了非 RP agent**：左栏列出 `maid:main`、`rp:alice`、`task:runner` 等所有 agent，缺少"只看 rp_agent"的过滤。debug RP 时噪声大。
- **C-4 没有 request list**：当你不是从某个 session 跳进来的时候，无法知道"最近 rp:alice 经历过哪些 request 可以查 trace"。

### 4.2 Data Gap（后端没写数据）

路由本身 OK，但写数据的代码路径要么缺失要么没被触发。

- **D-1 Core Blocks 对 RP agent 从未初始化**：没有任何代码路径在 `rp:alice` 首次启动 / 首次 turn 时调用 `coreMemory.initializeBlocks('rp:alice')`。结果就是所有 agent 都是 `{"blocks":[]}`。如果 Study 的默认 tab（按 §11.3）是 Core Blocks 且它永远空，则默认视图就是空壳。
- **D-2 Pinned Summaries 不是独立实体**：`handleListPinnedSummaries` 实际上复用 `coreMemory.getAllBlocks()` 然后按 `label === 'pinned_summary'` / `'persona'` 过滤。只要 D-1 不修，这个 facet 永远空。需要决定：(a) 让它变成独立表；(b) 修 D-1 让它有源数据；(c) 在 v1 阶段把这个 facet 标"Placeholder: requires core-blocks bootstrap"。
- **D-3 Narratives 对于纯 chat 类 RP 可能结构性地空**：area/world projection 的写入路径依赖 agent 产出带有 area/world 更新的事件。如果 Alice 的对话只是闲聊，那这里结构性永远空——**这不是 bug，是场景没覆盖**。可以用演示数据种一条让用户看到它"长什么样"。

### 4.3 Visibility Gap（数据产生了但看不到关键信息）

后端有数据，前端能渲染，但**展示的字段对 debug 不够用**。

- **V-1 Episode 没有暴露 `request_id` / `session_id`**：`EpisodeItem` 的 schema 里只有 `episode_id`、`settlement_id`、`category`、`summary`、`committed_time`、`created_at`、`private_notes?`、`location_text?`。看了一条 episode 无法回答"这是哪一次 turn 产生的"——要 debug 就必然需要能从 episode 反查到 request。
- **V-2 Settlement 没有暴露"这次结算产生了哪些 episode / 修改了哪些 narrative"**：当前 Settlement facet 只显示状态机字段（pending / claimed / applied），看不到"这次结算 bring in 了什么"。
- **V-3 Retrieval Trace 只显示 `query_string` / `strategy` / `segment_count` / 一堆 facet label**：没有展示实际**检索到了什么内容**——用户看完知道"检索了 3 段"但不知道是哪 3 段。如果这 3 段的原文不回传，debug 几乎没有抓手。
- **V-4 Core Block 没有历史 / diff**：即使 D-1 修了，现在也看不到"这个 block 是什么时候被改成现在这样的"。对 debug 而言，append / replace 历史是关键。

### 4.4 UX Gap（布局 / 交互 / 反馈）

现有页面能跑，但对高强度 debug 不够顺手。

- **U-1 无搜索 / 无分页**：Episode 列表一次最多 50 条（handler limit），但前端没有分页 UI，也没有按 category / summary 内容搜索的框。一旦 turn 多了就翻不动。
- **U-2 刷新是整体 refetch**：每个 facet 的 header 都有 refresh 按钮，但不支持"只刷新一条"或 incremental update。SSE tail 更不用说。
- **U-3 没有 agent 总览**：左栏每个 agent 只显示 display_name 和 role，没有"该 agent 今日产生了多少条 episode / 多少次 retrieval / 最近活跃时间"等摘要信息。debug 时要先点进去才知道哪个 agent 值得看。
- **U-4 时间戳 tooltip 缺失**：`formatTs` 显示 "Apr 13, 01:22 AM"，但一次 turn 内几条 episode 时间戳可能只差毫秒，肉眼看一样。需要 hover 显示完整毫秒级时间。
- **U-5 默认 facet 不对**：§11.3 要求默认 Core Blocks，但在 D-1 未修之前这是空壳。短期应默认 Episodes（最可能有数据）。

### 4.5 Cognition Gap（完全缺失）

Cognition 的 gap 不是"数据空"——数据写到 PG 了，只是没人给 Dashboard 看。这是**零可观察性**。

- **Cog-I-1 Gateway 路由**：0 条 cognition 相关路由。需要至少 4 条：
  - `GET /v1/agents/{agentId}/cognition/assertions?since=&limit=&stance=`
  - `GET /v1/agents/{agentId}/cognition/evaluations?since=&limit=`
  - `GET /v1/agents/{agentId}/cognition/commitments?status=&since=&limit=`
  - `GET /v1/agents/{agentId}/cognition/{cognition_key}/history`（单条 cognition 的 ledger 轨迹，看 stance 转变）
- **Cog-I-2 契约**：`src/contracts/cockpit/` 没有 cognition schema。需要新增 `cognition.ts`：`AssertionItem` / `EvaluationItem` / `CommitmentItem` / `CognitionHistoryEntry`。
- **Cog-I-3 读路径挂载**：需要在 gateway controllers 里调用 `cognitionProjectionRepo`（当前值）和 `cognitionEventRepo`（历史）——这两个 repo 已经存在，只是没人调。
- **Cog-V-1 Study facet 新增 "Cognition"**：前端需要一个新 facet，按类型分 sub-tab（Assertions / Evaluations / Commitments）。每条卡片显示 `stance` 或 `status`、最近变更时间、和原始 claim / target 内容。
- **Cog-V-2 Stance 时间线**：点击一条 assertion 弹出 "History" 抽屉，展示从 hypothetical → tentative → accepted / contested / rejected 的时间线。这是理解 RP agent 认知变化的关键视图。
- **Cog-V-3 反查到 request_id**：每条 cognition 记录带上 `settlement_id`，但 debug 时用户想知道"是哪次 turn 让 Alice 开始相信这件事的"。需要在 cognition event repo 写入时顺带记 `request_id`（和 SR-V-1 episode 的扩展是同一套路）。
- **Cog-C-1 Grand Hall session → Cognition 跳转**：transcript 里每条 assistant 消息旁除了 🔍（检索 trace），还要有 🧠（这次 turn 产生的 cognition ops）按钮，跳 Study 的 Cognition facet 并筛选 `settlement_id`。

### 4.6 Graph Memory Gap（完全缺失）

Graph 比 cognition 更复杂，也更容易做崩。需要定清楚 MVP 范围：**不**做全图浏览器，只做"scoped view around a seed"。

- **G-I-1 Gateway 路由**：至少 3 条：
  - `GET /v1/agents/{agentId}/graph/nodes?session_id=&since=&limit=&category=`（分页列事件节点）
  - `GET /v1/graph/nodes/{node_ref}/edges?types=logic,semantic,memory`（以一个节点为中心，列出相邻边）
  - `GET /v1/requests/{request_id}/navigator-trace`（Navigator 这次 beam 走了哪些节点，frontier / visited / selected）
- **G-I-2 契约**：`src/contracts/cockpit/` 新增 `graph.ts`：`EventNodeItem` / `GraphEdgeItem` / `NavigatorTraceItem`。
- **G-I-3 Navigator trace 记录**：当前 `trace-store.ts` 只存 `RetrievalTraceCapture`（query_string、strategy、counts）。需要扩展为同时记录 Navigator 的 `seeds[]` / `visited[]` / `selected[]` / `pruning_reasons[]`。写入点：`src/memory/navigator.ts` 里 beam search 的每个 step 回调 `onNodeVisit(nodeRef, reason)`。
- **G-V-1 Study facet 新增 "Graph"**：前端新 facet，默认视图是"Recent Events"——列最近 N 个 event_nodes，每个显示 `category` / `summary` / `participants` / `visibility_scope` / `node_scores.salience`。
- **G-V-2 节点详情 + 边展开**：点击一个 event node 弹出 drawer，展示：
  - 原始文本 + summary
  - 参与者（entity refs）
  - 入边 / 出边列表（按 `relation_type` 分组，logic / semantic / memory 三栏）
  - 每条边可点击导航到目标节点（在同一 drawer 内替换内容，**不做**全图画布）
- **G-V-3 Navigator trace 可视化**：在 Retrieval Trace facet 里追加"Walk"子视图，按顺序展示 Navigator 的 seed → frontier 扩展步骤。每步显示该 step 访问的节点、被哪条边带过来、score。
- **G-V-4 节点评分**：node detail drawer 底部显示 `salience` / `centrality` / `bridge_score` 三个评分条。
- **G-C-1 Cognition ↔ Graph 互跳**：assertion / evaluation / commitment 里的 `entityRefs[]` 可以点击跳到对应 entity node。反过来，event node drawer 里的 cognition-related edge（`supports` / `conflicts_with` / `derived_from`）可以跳回 Cognition facet。

**显式非目标（v1 不做）**：
- 全图交互式 canvas（force-directed / dagre 布局）
- 图上的编辑 / 手工连边
- 跨 session / 跨 agent 的图聚合视图
- 实时动画节点流动

原则：**只做"point query + 一跳邻居"的半结构化 drawer**，不做画布。画布是 v2+ 的事，今天的价值不足以抵消成本。

---

## 5. 工作项清单

编号约定：`SR-<类别>-<序号>`。类别：`C`=connectivity、`D`=data、`V`=visibility、`U`=UX、`I`=infra。

> **优先级**：P0 = Phase 1 驾驶舱的"debug RP 记忆"承诺的最低门槛；P1 = 让这个 debug 流程真正顺手；P2 = 锦上添花。

### P0 — 打通 debug 最小闭环

#### SR-C-1 Session detail 跳 Retrieval Trace
- **目标**：在 `GrandHallSessionPage.tsx` 的 transcript 里每条 assistant 消息旁边加一个"🔍 Retrieval Trace"链接，点击跳 `/study/{agentId}/retrieval-trace?request_id={requestId}`。
- **前置**：transcript entry 需要携带 `request_id`。检查 `src/api/sessions.ts` 的 `getTranscript` 响应里是否已经有 `request_id`；若没有就先从 `src/contracts/cockpit/` 看 transcript schema，必要时补一个派生字段。
- **涉及文件**：
  - 主要：`src/pages/GrandHallSessionPage.tsx`
  - 必要时：`src/api/sessions.ts`、`MaidsClaw/src/app/inspect/view-models.ts`（若 request_id 未在 transcript 里）
- **验收**：`e2e/phase1-cutover.spec.ts` 风格的 test：发一个 turn → transcript 里能看到 🔍 按钮 → 点击后 URL 变成 `/study/rp:alice/retrieval-trace?request_id=<uuid>` → trace facet 加载出 query_string / strategy 字段。
- **复杂度**：低（1-2 小时）。

#### SR-C-4 Study 内部"最近 requests"侧栏
- **目标**：在 Retrieval Trace facet 打开且 `request_id` 为空时，显示一个"最近这个 agent 参与过的 request"列表。点击任何一条回填 `request_id` 参数。
- **依赖**：`/v1/logs?agent_id=rp:alice&limit=20` 是否能用来列 request。现状 `/v1/logs?limit=5` 返回空数组——需要先确认 logs 是否会在 turn 后被写入。如果 logs 不靠谱，可改为 `/v1/sessions/{id}/transcript` 遍历推导 request_id，或在 MaidsClaw 新增一条 `/v1/agents/{id}/recent-requests`。
- **涉及文件**：
  - 前端：`src/pages/StudyPage.tsx::RetrievalTraceFacet`、`src/api/` 新增或扩展方法
  - 后端（如需）：`D:\Projects\MaidsClaw\src\gateway\routes\agents.ts` 或 `requests.ts`
- **验收**：Study Room 打开 Retrieval Trace facet 时，就算 URL 上没有 request_id，也能看到一个"Recent Requests"列表让用户选。
- **复杂度**：中。是否要改后端决定成本。

#### SR-V-1 Episode 暴露 request_id
- **目标**：`EpisodeItem` schema 增加 `request_id: string`（optional 起步），让用户从 Episode 一键跳到对应的 Retrieval Trace。
- **涉及文件**：
  - 后端：`D:\Projects\MaidsClaw\src\contracts\cockpit\memory.ts::EpisodeItemSchema`、`D:\Projects\MaidsClaw\src\memory\episode\*`（确认写入时能带上 request_id；通常 settlement 创建时是能拿到的）
  - 前端：`src/pages/StudyPage.tsx::EpisodesFacet` 增加一个"🔍 trace"按钮
- **验收**：rp:alice 的 episodes 列表里每条 episode 都能看到一个小字样 `req: abc123…` + 跳转链接。
- **复杂度**：中。需要沿 settlement 写入链路回溯 request_id 能否拿到。

#### SR-D-3 默认 facet 临时改为 Episodes
- **目标**：在 D-1 落地之前，把 `StudyPage.tsx::activeFacet` 的默认值从 `core-blocks` 改成 `episodes`，避免空壳首屏。
- **涉及文件**：`src/pages/StudyPage.tsx` 的 `FACETS` 顺序 / `activeFacet` 初始化。
- **验收**：打开 `/study/rp:alice` 默认落在 Episodes tab。
- **复杂度**：trivial（5 分钟）。

### P1 — 让 debug 真正顺手

#### SR-D-1 RP agent core-block 初始化
- **目标**：当 rp_agent（`rp:*`）首次启动或首次收到 turn 时，自动调用 `coreMemory.initializeBlocks(agentId)`，种 `persona` / `user` / `knowledge` 等初始块。`persona` 块内容从 `config/personas.json` 映射。
- **涉及文件**：
  - `D:\Projects\MaidsClaw\src\agents\rp\profile.ts` 或 `D:\Projects\MaidsClaw\src\runtime\turn-service.ts` 的 turn 开始路径。
  - `D:\Projects\MaidsClaw\src\memory\core-memory.ts`（可能要补 `initializeBlocksFromPersona` 之类 helper）
- **验收**：`curl /v1/agents/rp:alice/memory/core-blocks` 返回非空 `blocks` 数组，包含至少一个 `label === "persona"` 的块，内容来自 Alice persona 的 `persona` 字段。
- **复杂度**：中。要确认 RP agent 的生命周期 hook 点在哪里。

#### SR-C-2 War Room Failed Requests 跳转 Retrieval Trace
- **目标**：War Room 的 Event Stream → Failed Requests 子 tab 每条失败条目都能跳 `/study/{agentId}/retrieval-trace?request_id=...`。
- **涉及文件**：`src/pages/WarRoomPage.tsx`。
- **验收**：人为触发一次失败 turn（例如未配置的 provider），在 War Room 里看到这条记录并能跳转。
- **复杂度**：低。

#### SR-V-3 Retrieval Trace 展示检索到的原文
- **目标**：`RetrievalTrace` schema 扩展 `segments: Array<{ source: string; content: string; score?: number }>`，让 trace facet 不再只显示 segment_count，而是列出实际检索内容。
- **涉及文件**：
  - 后端：`D:\Projects\MaidsClaw\src\contracts\cockpit\memory.ts::RetrievalTraceSchema`、`D:\Projects\MaidsClaw\src\core\prompt-data-sources.ts` 的 `onRetrievalTraceCapture` 回调、`D:\Projects\MaidsClaw\src\app\diagnostics\trace-store.ts::setRetrieval`
  - 前端：`src/pages/StudyPage.tsx::RetrievalTraceFacet` 增加 segments 渲染
- **验收**：在 Dashboard 里打开某个 request 的 retrieval trace，能看到 "Segments (3)" 下面列出每段的 source + 内容片段。
- **复杂度**：中高。trace-store 的 bundle 结构要扩字段，记得同步 schema。

#### SR-C-3 Agent 过滤（只显示 rp_agent）
- **目标**：Study Room 左栏 agent 列表加一个 "Filter: rp_agent only" toggle，持久化到 `localStorage`。
- **涉及文件**：`src/pages/StudyPage.tsx` 左栏 + `src/hooks/usePrefs.ts`（或新 hook）。
- **验收**：刷新后 toggle 状态保留。
- **复杂度**：低。

#### SR-U-3 左栏 agent 活跃摘要
- **目标**：每个 agent 条目右侧显示 "N episodes today"。数据来源：`/v1/agents/{id}/memory/episodes?since=<today>` 的 count。
- **涉及文件**：`src/pages/StudyPage.tsx` 左栏 + 一个轻量聚合 query。
- **验收**：Alice 条目显示 "2 ep"（与 Phase 1 测试产生的 episode 数一致）。
- **复杂度**：低。

#### SR-U-4 时间戳 hover 完整时间
- **目标**：所有 `formatTs` 的位置包一层 `<time title={new Date(ts).toISOString()}>`。
- **涉及文件**：`src/pages/StudyPage.tsx`（多处）、或抽一个 `<Timestamp>` 组件到 `src/components/ui/`。
- **复杂度**：trivial。

### P2 — 生成过程的"直播视图"

这一组是 v2 味道浓的增强，列在这里以免忘。

#### SR-I-1 Turn SSE 追加 memory_written 事件
- **目标**：`POST /v1/sessions/{id}/turns:stream` 的 SSE 流里除了当前 `delta` / `status`，额外吐 `memory_written { episode_ids[], settlement_id, narrative_updates[] }` 和 `retrieval_started { query_string }` / `retrieval_completed { segment_count }`。前端消费成一条时间线叠在 chat 上。
- **涉及文件**：
  - 后端：`D:\Projects\MaidsClaw\src\gateway\sse.ts` 事件类型扩充、turn service 的各写入点广播
  - 前端：`src/stream/turn-stream.ts`、`src/pages/GrandHallSessionPage.tsx` 渲染时间线
- **复杂度**：高。涉及事件模型扩张。

#### SR-V-4 Core Block 历史 / diff 视图
- **目标**：Core Block 详情下展示 append / replace 历史时间线。
- **前置**：后端需要记录历史（当前 repo 是 CRUD，不留历史）。
- **涉及文件**：`D:\Projects\MaidsClaw\src\memory\core-memory.ts`、`storage/domain-repos/pg/core-memory-block-repo.ts`（假设）。
- **复杂度**：中高。

#### SR-V-2 Settlement → Episodes 关联视图
- **目标**：点击一条 Settlement 弹出 "Produced Episodes" 列表（同 settlement_id）。
- **涉及文件**：`src/pages/StudyPage.tsx::SettlementsFacet` 加展开交互；后端无需改。
- **复杂度**：低。

### Track B — Cognition 子系统（全新，跨前后端）

所有 Cognition 相关条目都属于**P0 级**——因为这是"RP agent 为什么这么想"的 debug 主入口，v1 驾驶舱不能不做。

#### SR-Cog-I-1 Gateway 新增 cognition 路由
- **目标**：在 MaidsClaw 暴露 4 条 cognition 路由：
  - `GET /v1/agents/{agentId}/cognition/assertions?since=&limit=&stance=&kind=`
  - `GET /v1/agents/{agentId}/cognition/evaluations?since=&limit=`
  - `GET /v1/agents/{agentId}/cognition/commitments?status=&since=&limit=`
  - `GET /v1/agents/{agentId}/cognition/{cognition_key}/history`
- **涉及文件**：
  - 新建 `D:\Projects\MaidsClaw\src\gateway\routes\cognition.ts`（参照 `memory.ts` 结构）
  - 在 `D:\Projects\MaidsClaw\src\gateway\controllers.ts` 新增 `handleListAssertions` / `handleListEvaluations` / `handleListCommitments` / `handleCognitionHistory`
  - 在 `D:\Projects\MaidsClaw\src\gateway\context.ts` 注入 `cognitionProjectionRepo` 和 `cognitionEventRepo`（已存在于 `src/storage/domain-repos/pg/`）
  - 在 `src/gateway/routes/index.ts::ROUTES` 数组末尾追加 `...COGNITION_ROUTES`
- **验收**：
  - `curl /v1/agents/rp:alice/cognition/assertions` 返回非空 assertion 列表（前提：先跑一次 rp:alice turn）
  - `curl /v1/agents/rp:alice/cognition/commitments?status=active` 过滤正确
  - 每条记录带 `settlement_id` 和 `committed_time`
- **复杂度**：中（2-4 小时，全部是 pattern-match 工作，难点在 controller 层的时间过滤 + stance 过滤参数校验）。

#### SR-Cog-I-2 Cognition 契约 schema
- **目标**：新增 `D:\Projects\MaidsClaw\src\contracts\cockpit\cognition.ts`，定义：
  ```ts
  AssertionItemSchema: { cognition_key, kind, holder_id, claim, entity_refs[], stance,
      basis?, pre_contested_stance?, salience?, settlement_id, committed_time }
  EvaluationItemSchema: { cognition_key, kind, target, dimensions[], emotion_tags?,
      notes?, salience?, settlement_id, committed_time }
  CommitmentItemSchema: { cognition_key, kind, mode, target, status, priority?,
      horizon?, salience?, settlement_id, committed_time }
  CognitionHistoryItemSchema: { op, stance?, status?, settlement_id, committed_time,
      record_json? }
  ```
- **涉及文件**：
  - 新建 `D:\Projects\MaidsClaw\src\contracts\cockpit\cognition.ts`
  - 在 `src/contracts/cockpit/browser.ts` re-export
- **验收**：Dashboard `tsc` 通过；`import type { AssertionItem } from '@maidsclaw/contracts/browser.js'` 生效
- **复杂度**：低（0.5-1 小时）。

#### SR-Cog-F-1 Dashboard 新增 Cognition facet
- **目标**：Study Room 新增第 7 个 facet `cognition`，带 3 个 sub-tab：`Assertions` / `Evaluations` / `Commitments`。
- **涉及文件**：
  - `src/pages/StudyPage.tsx`：`FACETS` 数组追加 `{ key: 'cognition', label: 'Cognition', icon: Brain }`，添加 `CognitionFacet` 组件
  - `src/api/cognition.ts`（新）：`listAssertions` / `listEvaluations` / `listCommitments` / `getCognitionHistory`
  - `src/query/keys.ts`：`queryKeys.cognition.assertions(agentId)` 等
  - `src/App.tsx`：路由支持 `/study/:agentId/cognition/:subTab?`（可选）
- **验收**：打开 `/study/rp:alice/cognition`，默认显示 Assertions sub-tab，至少有 1 条记录（来自 Phase 1 E2E 产生的 turn）
- **复杂度**：中（2-3 小时）。

#### SR-Cog-F-2 Stance 时间线 drawer
- **目标**：点击一条 assertion 弹出抽屉，显示该 `cognition_key` 的完整 history：stance 转变时间线（hypothetical → tentative → accepted → confirmed / contested / rejected）。
- **涉及文件**：
  - `src/components/CognitionHistoryDrawer.tsx`（新）
  - `src/pages/StudyPage.tsx::CognitionFacet` 注入打开 drawer 的行为
- **验收**：可以看到 Alice 某条信念的 stance 演化路径
- **复杂度**：低（1-2 小时）。

#### SR-Cog-V-3 Cognition 记录带 request_id
- **目标**：`private_cognition_events` 的写入路径（`src/memory/explicit-settlement-processor.ts`）保证每条记录能记下 `request_id`。表结构可能需要加列 `request_id TEXT NULL`。
- **依赖**：SR-V-1 做同样的改动给 episodes。可以合并一起做。
- **涉及文件**：
  - `D:\Projects\MaidsClaw\src\storage\pg-app-schema-truth.ts`（加列）
  - `D:\Projects\MaidsClaw\src\storage\domain-repos\pg\cognition-event-repo.ts`（写入时 bind request_id）
  - 相应 cognition schema 加 `request_id?`
- **验收**：新 cognition 记录的 response 中有 `request_id`
- **复杂度**：中（涉及迁移）。

#### SR-Cog-C-1 Grand Hall session → Cognition 跳转
- **目标**：`GrandHallSessionPage.tsx` 的 transcript 里每条 assistant 消息加 🧠 按钮，跳 `/study/{agentId}/cognition?settlement_id={id}` 或 `?request_id={id}`。
- **依赖**：SR-C-1（🔍 retrieval 跳转）做完后这个是复用同一套 pattern。
- **涉及文件**：`src/pages/GrandHallSessionPage.tsx`
- **复杂度**：低。

### Track C — Graph Memory 子系统（全新，跨前后端）

所有 Graph 相关条目默认**P1 级**——比 cognition 低一档，因为"相关性 / 检索理由"虽然对 debug 很有价值，但不是"Alice 为什么这么说"的最直接解释。Navigator trace（SR-Graph-I-3）例外，归 P0。

#### SR-Graph-I-1 Gateway 新增 graph 路由
- **目标**：在 MaidsClaw 暴露 2 条基础图查询路由：
  - `GET /v1/agents/{agentId}/graph/nodes?session_id=&since=&limit=&category=&visibility=`
  - `GET /v1/graph/nodes/{node_ref}/edges?types=logic,semantic,memory&direction=out|in|both`
- **原则**：**不**提供"遍历整张图"或"按 node_ref 模糊搜索"——只支持 "scoped list + point query + 一跳邻居"。
- **涉及文件**：
  - 新建 `D:\Projects\MaidsClaw\src\gateway\routes\graph.ts`
  - 新增 `handleListEventNodes` / `handleListNodeEdges` controllers
  - 复用 `graphEdgeView.readLogicEdges / readSemanticEdges / readMemoryRelations`（已存在）
- **验收**：
  - `curl /v1/agents/rp:alice/graph/nodes?limit=10` 返回最近 10 个 event node
  - `curl /v1/graph/nodes/event:123/edges?types=logic` 返回该 node 的逻辑边
- **复杂度**：中高（3-5 小时，关键在 node_ref 编码 / 解析）。

#### SR-Graph-I-2 Graph 契约 schema
- **目标**：`D:\Projects\MaidsClaw\src\contracts\cockpit\graph.ts` 新增：
  - `EventNodeItemSchema: { id, session_id, timestamp, summary, event_category, visibility_scope, participants[], salience?, centrality?, bridge_score? }`
  - `GraphEdgeItemSchema: { source_ref, target_ref, relation_type, layer: 'logic'|'semantic'|'memory', weight, created_at }`
  - `NavigatorTraceItemSchema: { request_id, seeds[], steps[{ depth, visited_ref, via_edge?, score, pruned? }], final_selection[] }`
- **涉及文件**：新建 schema + browser.ts 导出
- **复杂度**：低。

#### SR-Graph-I-3 Navigator trace 捕获（P0）
- **目标**：`src/app/diagnostics/trace-store.ts::TraceBundle` 扩展 `navigator?: NavigatorTraceCapture`。在 `src/memory/navigator.ts` 的 beam search 每步回调 `onNodeVisit` 填充该字段。然后在 `src/gateway/routes/requests.ts` 追加 `/v1/requests/{id}/navigator-trace` 或把它合并到现有 `/v1/requests/{id}/retrieval-trace` 返回体里。
- **涉及文件**：
  - `D:\Projects\MaidsClaw\src\app\diagnostics\trace-store.ts`
  - `D:\Projects\MaidsClaw\src\memory\navigator.ts`
  - `D:\Projects\MaidsClaw\src\gateway\controllers.ts::handleRequestRetrievalTrace`
  - `D:\Projects\MaidsClaw\src\contracts\cockpit\memory.ts::RetrievalTraceSchema`（扩展或并列）
- **验收**：trace facet 能看到"这次 navigator 从 seed A 出发，走过 node B via logic_edge，最终选中 {A, B, C}"的轨迹
- **复杂度**：中高。navigator 里 hook 点的设计要注意性能（不要在热路径打 JSON.stringify）。

#### SR-Graph-F-1 Dashboard 新增 Graph facet
- **目标**：Study Room 新增 facet `graph`，默认展示 "Recent Event Nodes" 列表。
- **涉及文件**：`src/pages/StudyPage.tsx` + `src/api/graph.ts`(新) + `src/query/keys.ts`
- **复杂度**：中（2-3 小时）。

#### SR-Graph-F-2 Node detail drawer
- **目标**：点击一个 event node 弹抽屉：显示原文 / summary / participants / visibility / 得分条。抽屉底部分三栏列出出入边，按 `logic` / `semantic` / `memory` 分组。点击边上的节点，drawer 内容替换为该节点。
- **涉及文件**：`src/components/GraphNodeDrawer.tsx`（新）
- **验收**：能从一个 event node 点击边跳到相邻节点并回溯
- **复杂度**：中。

#### SR-Graph-F-3 Navigator walk 可视化
- **目标**：Retrieval Trace facet 追加 "Walk" 子视图，按步骤展示 navigator beam search。
- **依赖**：SR-Graph-I-3
- **涉及文件**：`src/pages/StudyPage.tsx::RetrievalTraceFacet`
- **复杂度**：中（2-3 小时）。

#### SR-Graph-F-4 Cognition ↔ Graph 互跳
- **目标**：Cognition 卡片里的 `entity_refs[]` 渲染为可点击 chip，跳 Graph facet 的该 entity。反之，Graph node drawer 里的 `supports` / `conflicts_with` 等 memory_relations 可跳回 Cognition facet。
- **依赖**：SR-Cog-F-1 + SR-Graph-F-1 + SR-Graph-F-2
- **复杂度**：低（1-2 小时 pattern 工作）。

---

## 6. 推荐执行顺序

本文档工作项按三条**独立 track**组织。Track 之间可并行，单 track 内部严格串行。

### Track A — 现有 facet 连通性与数据补全（Dashboard 为主）

这是最短的路径，让 episodes / retrieval-trace 这两个已经通的子系统真正可用。

1. **SR-D-3**（改默认 facet）— 5 分钟，立刻止损。
2. **SR-C-1**（Session detail → Retrieval Trace 跳转）— 30 分钟。
3. **SR-V-1**（Episode 带 request_id）— 1-2 小时，跨前后端。
4. **SR-C-4**（Recent Requests 侧栏）— 1-2 小时。
5. **SR-V-3**（Retrieval segments 原文）— 2-3 小时。
6. **SR-D-1**（RP core-blocks 初始化）— 1-3 小时。

**Track A 完成后**，可以回答："发 turn → 看 assistant 回复 → 点 🔍 → 看到这次检索了哪些段、哪些 episode 被写入"。约 6-10 小时工作量。

### Track B — Cognition 子系统（跨前后端全新）

这条 track 是"Alice 为什么这么说"的核心 debug 入口，**与 Track A 完全独立，可并行**。

1. **SR-Cog-I-2**（契约 schema）— 0.5-1 小时，前置。
2. **SR-Cog-I-1**（Gateway 路由）— 2-4 小时。
3. **SR-Cog-F-1**（Dashboard Cognition facet）— 2-3 小时。
4. **SR-Cog-F-2**（Stance 时间线 drawer）— 1-2 小时。
5. **SR-Cog-V-3**（Cognition 带 request_id）— 视 SR-V-1 是否已合并，1-2 小时。
6. **SR-Cog-C-1**（Grand Hall → Cognition 🧠 跳转）— 30 分钟，复用 SR-C-1 pattern。

**Track B 完成后**，可以回答："这一轮 Alice 形成了什么信念 / 评价 / 承诺？这条信念的 stance 是怎么一步步变过来的？"。约 7-13 小时工作量。

### Track C — Graph Memory 子系统（跨前后端全新）

Graph memory 比 Cognition 更底层，debug 价值更间接，优先级低一档。Navigator trace 例外，因为它直接服务"为什么这个记忆被检索到了"的 debug 需求。

**Track C 子序列**：

C1. **SR-Graph-I-3**（Navigator trace 捕获，P0 级）— 3-5 小时。**优先**，它和 Track A 的 SR-V-3 合流，构成完整的 retrieval debug。

C2. 剩下的 graph facet（C-1 完成后再动）：
- **SR-Graph-I-2**（契约）— 0.5-1 小时
- **SR-Graph-I-1**（Gateway 基础路由）— 3-5 小时
- **SR-Graph-F-1**（Graph facet）— 2-3 小时
- **SR-Graph-F-2**（Node drawer）— 2-3 小时
- **SR-Graph-F-3**（Navigator walk 可视化，依赖 C1）— 2-3 小时
- **SR-Graph-F-4**（Cog ↔ Graph 互跳）— 1-2 小时

**Track C 完成后**，可以回答："这一 turn 产生了哪些 event node？Navigator 走了什么路径才选中它们？两个信念之间是不是有语义冲突边？"。总计约 13-21 小时。

### 推荐总顺序

如果只有你一个人在做，建议交错推进：

1. Track A 的 SR-D-3、SR-C-1、SR-V-1（3 小时内就能让 Track A 有感知的进步）
2. 中途切到 Track B 的 SR-Cog-I-2 + SR-Cog-I-1（这两步 MaidsClaw 重启一次就通了）
3. 回 Track A 做完 SR-C-4 / SR-V-3 / SR-D-1
4. 回 Track B 做完 SR-Cog-F-1 / SR-Cog-F-2 / SR-Cog-C-1
5. 最后 Track C：先做 SR-Graph-I-3（Navigator trace 捕获），它直接升级 retrieval debug 的价值；其余 graph 工作项按需推进

**最小 v1 驾驶舱承诺 = Track A (1-6) + Track B (1-4, 6)**。约 15-20 小时。

**完整 debug 闭环 = Track A + Track B + Track C**。约 30-40 小时。

---

## 7. 验证方案

### 7.1 E2E 测试模板（Track A）

新增 `e2e/study-room.spec.ts`（对齐 `e2e/phase1-cutover.spec.ts` 风格）：

1. **A. 默认 facet**：访问 `/study/rp:alice`，断言当前 tab 是 Episodes（SR-D-3 验证）
2. **B. 跳转闭环**：发 turn → 在 session detail 看到 🔍 按钮 → 点击 → URL 匹配 `/study/rp:alice/retrieval-trace?request_id=<uuid>` → 看到 query_string 字段（SR-C-1 验证）
3. **C. Episode 反查**：进入 Episodes facet → 找到带 `req:` 字样的条目 → 点击跳 retrieval-trace → URL 参数一致（SR-V-1 验证）
4. **D. Retrieval Segments**：retrieval-trace 页面能看到至少一条 "segments" 列表项且内容非空（SR-V-3 验证）
5. **E. Core Blocks 非空**：访问 `/study/rp:alice/core-blocks`，至少能看到一个 `label === "persona"` 的块（SR-D-1 验证）

### 7.2 E2E 测试模板（Track B — Cognition）

新增 `e2e/study-room-cognition.spec.ts`：

1. **Cog-A. 路由存在**：`GET /v1/agents/rp:alice/cognition/assertions` 返回 200 且 schema 符合 `AssertionItemSchema`（SR-Cog-I-1 验证）
2. **Cog-B. Facet 渲染**：打开 `/study/rp:alice/cognition`，默认在 Assertions sub-tab，能看到至少 1 条数据（要求先跑一次 turn 让 thinker 产生 cognition ops）（SR-Cog-F-1 验证）
3. **Cog-C. Stance 时间线**：点击一条 assertion → 弹出 history drawer → 展示至少一个 stance 条目（SR-Cog-F-2 验证）
4. **Cog-D. Request 反查**：assertion / evaluation / commitment 记录都带 `request_id` 字段（SR-Cog-V-3 验证）
5. **Cog-E. Grand Hall 跳转**：session detail 的 assistant 消息旁的 🧠 按钮 → 跳 cognition facet 并过滤 settlement_id（SR-Cog-C-1 验证）

### 7.3 E2E 测试模板（Track C — Graph Memory）

新增 `e2e/study-room-graph.spec.ts`：

1. **G-A. Navigator trace 捕获**：`GET /v1/requests/{id}/retrieval-trace` 的响应体包含 `navigator` 字段，里面至少一个 `steps[]` 条目（SR-Graph-I-3 验证）
2. **G-B. Node list**：`GET /v1/agents/rp:alice/graph/nodes?limit=10` 返回非空且按时间倒序（SR-Graph-I-1 验证）
3. **G-C. Edge query**：`GET /v1/graph/nodes/event:<id>/edges?types=logic` 返回非空 edge 列表（SR-Graph-I-1 验证）
4. **G-D. Graph facet 渲染**：打开 `/study/rp:alice/graph` → 点击一个节点 → drawer 出现 → 显示至少一条 logic 边 → 点击目标节点 → drawer 内容切换（SR-Graph-F-1 + SR-Graph-F-2 验证）
5. **G-E. Navigator walk**：retrieval-trace facet 切到 Walk 子视图 → 看到 seed → frontier 扩展步骤（SR-Graph-F-3 验证）
6. **G-F. Cog ↔ Graph 互跳**：Cognition 卡片的 entity chip 点击 → 跳 Graph facet 并定位 entity（SR-Graph-F-4 验证）

### 7.4 手动验证清单

在完成任一工作项后：

- [ ] `bun run typecheck && bun run lint`（Dashboard）
- [ ] `bun test` 相关 schema 兼容性测试（MaidsClaw）
- [ ] 手动跑一次 turn（使用现有 `e2e/phase1-cutover.spec.ts` 的 B 场景作为起点）
- [ ] 浏览器打开 Study Room，按上面的 7.1 / 7.2 / 7.3 E2E 顺序肉眼过一遍
- [ ] `curl` 所有相关路由确认 schema 没退化（每做完一条 track，对应 track 的所有路由都要 curl 一次）

### 7.5 契约兼容性守护

按 `refactor-consensus.md` §10.1 测试策略：
- 任何动到 `D:\Projects\MaidsClaw\src\contracts\cockpit\memory.ts` / `cognition.ts`（新）/ `graph.ts`（新）的 PR，必须跑 Dashboard 的 typecheck。
- Dashboard 侧所有 `import type { ... } from '@maidsclaw/contracts/browser.js'` 会在编译期暴露 schema drift。
- 新增 `cognition.ts` 和 `graph.ts` 必须在 `browser.ts` 中 re-export，否则 Dashboard 无法 import。

---

## 8. 非目标与延后项

明确本文档**不**覆盖以下内容，避免 scope creep：

- 记忆**写**能力（P0-2 in `v2-roadmap.md`）——Study Room v1 纯只读，cognition / graph 都是只读
- Memory editor（append / replace UI）
- 全图交互式 canvas（force-directed / dagre 布局）——Graph facet v1 是 "point query + 一跳邻居 drawer"，不是画布
- Cognition 的人工编辑 / 手动 stance 覆写
- 跨 session / 跨 agent 的记忆搜索与聚合
- 记忆导出 / 备份 / 版本回滚
- 语义搜索 UI（embedding-based 前端检索）
- Navigator beam search 参数调优 UI
- `node_embeddings` 的向量可视化（PCA / t-SNE 等）

这些都不是 Phase 1 的承诺。

---

## 9. 文档索引

### 原始规格
- `docs/refactor-consensus.md` §7.2 / §7.3 / §11.3：Study Room 架构原始定义
- `docs/v2-roadmap.md` P0-2：Study Room Memory 写能力（v2 升级项）

### 现有 memory 路由（已暴露）
- `D:\Projects\MaidsClaw\src\gateway\routes\memory.ts`：core-blocks / episodes / narratives / settlements / pinned-summaries
- `D:\Projects\MaidsClaw\src\gateway\controllers.ts::handleListCoreMemoryBlocks` 等：handler 实现
- `D:\Projects\MaidsClaw\src\app\diagnostics\trace-store.ts`：retrieval trace 存储
- `D:\Projects\MaidsClaw\src\contracts\cockpit\memory.ts`：现有 memory schema

### Cognition 子系统（未暴露）
- `D:\Projects\MaidsClaw\src\memory\cognition\cognition-repo.ts`：读写 API
- `D:\Projects\MaidsClaw\src\memory\cognition-op-committer.ts`：turn 结算时的 commit
- `D:\Projects\MaidsClaw\src\storage\domain-repos\pg\cognition-event-repo.ts`：`private_cognition_events` ledger
- `D:\Projects\MaidsClaw\src\storage\domain-repos\pg\cognition-projection-repo.ts`：投影视图
- `D:\Projects\MaidsClaw\src\runtime\thinker-worker.ts`：`PrivateCognitionCommitV4` 产出点
- `D:\Projects\MaidsClaw\src\memory\explicit-settlement-processor.ts` (~line 170)：`commitCognitionOps()` 调用点

### Graph memory 子系统（未暴露）
- `D:\Projects\MaidsClaw\src\memory\graph-organizer.ts`：异步 organizer job
- `D:\Projects\MaidsClaw\src\memory\graph-edge-view.ts`：多层 edge 读 API
- `D:\Projects\MaidsClaw\src\memory\navigator.ts`：beam search 实现
- `D:\Projects\MaidsClaw\src\storage\pg-app-schema-truth.ts`：`event_nodes` / `logic_edges` / `memory_relations`
- `D:\Projects\MaidsClaw\src\storage\pg-app-schema-derived.ts`：`semantic_edges` / `node_embeddings` / `node_scores`
- `D:\Projects\MaidsClaw\src\storage\domain-repos\pg\graph-mutable-store-repo.ts`：写入 API

### Dashboard 侧
- `D:\Projects\Maids-Dashboard\src\pages\StudyPage.tsx`：Study Room 渲染
- `D:\Projects\Maids-Dashboard\src\api\memory.ts` / `src/api/requests.ts`：Dashboard 现有 API 客户端
- `D:\Projects\Maids-Dashboard\e2e\study-room-survey.spec.ts`：当前状态抓取脚本

---

## 变更记录

- **2026-04-13 初稿**：基于 Phase 1 验收后现场实测 + 双仓代码审读，记录 6 个已有 facet 的当前真实状态与落地计划。
- **2026-04-13 第二版（cognition + graph 补全）**：补齐 cognition 子系统（`§2.4 / §3.3 / §4.5 / Track B`）和 graph memory 子系统（`§2.5 / §3.4 / §4.6 / Track C`）。结论：前端 Study Room 对这两个子系统**零可观察入口**——后端有完整数据，没有任何 gateway 路由。重新估算：完整 debug 闭环约 30-40 小时工作量（比第一版翻倍）。
- **2026-04-14 Live E2E 实测发现（Playwright MCP 驱动）**：见下方 §10。

---

## 10. 2026-04-14 Live E2E 实测（Playwright MCP 驱动）

本轮测试用 Playwright MCP 驱动浏览器走 `RP_LIVE_TEST_70_TURNS.zh-CN.md`，在 Alice session 上实跑对话并巡检 Study Room 所有 facet。修复了两个阻塞性的 runtime 配线 bug，另外发现一个数据断点待后续排查。

### 10.1 已修复的 Runtime Gap（本次会话已落地）

**Gap Runtime-1 — `server` 角色下无任何 durable job consumer 启动**
- 根因：`D:\ACodingWorkSpace\MaidsClaw\src\index.ts` 以 `role: "server"` 启动 `createAppHost`，但 **没有传 `enableDurableOrchestration: true`**。`create-app-host.ts:366-383` 的三条 consumer 创建路径：
  - `workerConsumer`：仅 `role === "worker"` — 不命中
  - `serverDurableConsumer`：需要 `role === "server" && enableDurableOrchestration === true` — 不命中
  - `localDurableConsumer`：仅 `role === "local"` — 不命中
- 症状：`jobs_current` 表内 35+ 条 `cognition.thinker` job 全部 `status=pending / attempt_count=0 / claimed_by=null`。对应 Alice session 有 105 条 `interaction_records`、20+ 条真实 `request_id` 链接，但 `private_episode_events / private_cognition_current / core_memory_blocks / graph_nodes` 全部为 0。Study Room 的每一个 facet 都返回空状态——不是渲染 bug，而是后端从未产出任何可观察数据。
- 修复：`src/index.ts` 的 `createAppHost` 调用里加 `enableDurableOrchestration: true`。这条开关同时激活 `serverDurableConsumer` 和 `leaseReclaimSweeper`，使 HTTP server 和 durable job worker 在同一个进程里共存。
- 验证：重启 gateway 后 `cognition.thinker` 开始 claim job 并产出 `private_episode_events` / `private_cognition_current` / `private_cognition_events` 数据。

**Gap Runtime-2 — `memory.organize` job 类型无 worker 注册**
- 根因：`create-app-host.ts` 的 `createPgJobConsumer` 只注册了 `cognition.thinker` 一个 job 类型的 handler。`memory.organize` job 被 talker 流水线正常入队（`src/memory/task-agent.ts:670` 构造 `GraphOrganizerJob` → `enqueueOrganizerJobs`），但无 worker 认领，最终以 `No worker registered for job type: memory.organize` 消息耗尽 4 次尝试进入 `failed_terminal`。
- 症状：`graph_nodes / memory_relations / fact_edges / logic_edges / semantic_edges / entity_nodes / event_nodes / node_embeddings / node_scores` 全部为 0。Study Room 的 **Graph facet** 即使前端逻辑已经按 PR1 的 `layer` 分组正常渲染，也没有任何节点数据可以展示。
- 修复：`create-app-host.ts:createPgJobConsumer` 里追加一个 `runner.registerWorker("memory.organize", ...)` handler。它解析 payload（`{ settlementId, agentId, chunkOrdinal, chunkNodeRefs, embeddingModelId, sourceSessionId? }`），映射为 `GraphOrganizerJob`，调用 `runtime.memoryTaskAgent.runOrganize(job)`。`batchId` 用 `${settlementId}:chunk:${chunkOrdinal}` 拼接保证幂等。
- 验证：typecheck 通过（`bunx tsc --noEmit -p tsconfig.build.json`）。实际 drain 需要 MaidsClaw 重启后观察 `graph_nodes` 等表是否增长。

### 10.2 待排查：Gap B — `core_memory_blocks` 在 9 个 session 跑过后仍为 0

**现象**：
- Alice 的 `sessions` 表有 4 条记录，`rp:eveline` 2 条，`maid:main` 3 条，合计 9 条。
- `interaction_records` 表有 105 条 user↔agent 交互。
- `core_memory_blocks` 表 **完全空**（0 行）。
- Study Room → Core Blocks facet 对所有 agent 均显示空状态。

**为什么这是个问题**：
- `core_memory_blocks` 是 RP agent "持久记忆画像"的核心基础。CoreMemoryService 在 `initializeFromPersonaSnapshot` 时会为每个 agent 创建一组 block（典型的 `persona / human / index` 等），后续 RP 对话里 `CoreMemoryIndexUpdater` 也会更新 `index` block。这些 block 被 `computeNodeScore` 用于 salience 打分（`graph-organizer.ts:236`：`const indexBlock = await this.coreMemory.getBlock(agentId, "index")`），如果 block 不存在，salience 评分路径会抛/退化，间接影响 graph 质量。
- 即使 Study Room 的其它 facet（Episodes / Cognition）已经产出数据，Core Blocks facet 永远空就意味着这条"第一次激活 agent 就 bootstrap core memory"的路径没跑通。

**已知的相关代码**（本会话未深入排查，只做方向定位）：
- `D:\ACodingWorkSpace\MaidsClaw\src\runtime\turn-service.ts:250` 附近：`initializeFromPersonaSnapshot` 的调用点。之前的 Plan PR3（fb4c511 那一批）给这条路径加过 integration test，用 monkey-patch 方式验证 `coreMemoryService.initializeFromPersonaSnapshot` 被调用。
- `D:\ACodingWorkSpace\MaidsClaw\src\memory\core-memory.ts`：`CoreMemoryService` 实现。
- `D:\ACodingWorkSpace\MaidsClaw\src\bootstrap\runtime.ts`：`coreMemoryService = new CoreMemoryService(coreMemoryBlockRepo)` 装配点。
- `D:\ACodingWorkSpace\MaidsClaw\src\storage\domain-repos\pg\core-memory-block-repo.ts`：`core_memory_blocks` 表的写入路径。

**怀疑的几个方向**（按从高到低可能性排序）：
1. **Bootstrap 被 try/catch 静默吞掉**：`turn-service.ts:250` 附近的 `initializeFromPersonaSnapshot` 调用可能被宽松的 try/catch 包裹，persona snapshot 查询失败（比如 `config/personas.json` 的 `alice` 条目格式不符）时静默跳过。需要打日志或 repro 验证。
2. **Persona snapshot 源本身就是空的**：`personaService.getCard("alice")` 的返回内容可能是空的 / 缺 `systemPrompt` 等字段，导致 `initializeFromPersonaSnapshot` 被调用但构造了 0 个 block。
3. **`isPersistent` gate**：`CoreMemoryService.initializeFromPersonaSnapshot` 可能只对 `lifecycle === "persistent"` 的 agent 生效。`rp:alice` 在 `/v1/agents` 响应里确实是 `persistent`，但 `maid:main` 和其他也是，全部空说明不是这一层过滤。
4. **表名 typo / schema 不一致**：之前修过 `cognition_current → private_cognition_current` 的同类 bug。`core_memory_blocks` 的 SQL 可能指向了错误的表名。快速验证方式：grep `core_memory_blocks` / `FROM core_memory` 的所有 SQL 语句。
5. **Bootstrap 只在第一个 user turn 跑**：如果 bootstrap 只在 session 建立的第一条 user message 时触发，而不是在 agent 被 "首次访问" 时触发，那么第一条消息如果命中某个快速失败路径（比如 model 调用限流），bootstrap 就不会发生，后续 turn 又因为"已经初始化过"而跳过。

**排查步骤建议**：
1. 在 `turn-service.ts:250` 附近加 `console.log("[bootstrap] initializing core memory for agent=...")`，重启 gateway 后开一个新 Alice session 发一条消息。
2. 如果上面的日志根本不打印 → 问题在 turn-service 的分发条件（方向 5）。
3. 如果打印了 → 直接查 `core_memory_blocks` 表 `WHERE agent_id = 'rp:alice'`；如果有行说明是 Dashboard 查询端问题（Core Blocks facet 的 gateway 路由 / SQL 错）；如果没有 → 问题在 CoreMemoryService 的写入路径（方向 1、2、3、4）。
4. 再排查方向 4：`grep -n "core_memory_blocks" D:\ACodingWorkSpace\MaidsClaw\src -r` 比对表名是否一致。

**影响范围**：
- **直接影响**：Study Room → Core Blocks facet 完全不可用。
- **间接影响**：`GraphOrganizer.computeNodeScore` 的 `indexPresence` 信号恒为 0，salience 打分永远偏低——graph 节点排序质量受损。
- **不影响**：Episodes / Cognition / Retrieval Trace / Settlements / Narratives / Pinned Summaries / Graph（只要 Gap Runtime-2 已修）可以正常验证。

**推荐处理方式**：开一个独立的排查会话，专注从 `turn-service.ts` 往下 trace。这个问题的根因可能跨 3-4 个文件，在当前 E2E 测试会话里处理会污染上下文。

### 10.3 测试状态快照（写本节时）

- **cognition.thinker worker**：✅ 运行中，持续 drain 积压 job。
- **memory.organize worker**：⏳ 已实现，等待 gateway 重启后观察 drain 行为。
- **Episodes facet**：✅ 后端有数据（`private_episode_events` 7+ 行）。
- **Cognition facet**：✅ 后端有数据（`private_cognition_current` 5+ 行）。
- **Graph facet**：⏳ 依赖 memory.organize 重启后 drain 才能验证。
- **Core Blocks facet**：❌ 阻塞于 Gap B，排查推迟。
- **Retrieval Trace / Settlements / Pinned Summaries / Narratives**：尚未在本轮测试中逐一点击验证，下一阶段执行。
