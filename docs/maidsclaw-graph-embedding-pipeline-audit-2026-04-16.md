# MaidsClaw Graph/Embedding 管线完整审计报告

生成时间：2026-04-16  
分析对象：`D:\Projects\MaidsClaw` 代码库（branch `refactor/maidsclaw`）  
方法：源码静态分析 + 数据库实测 + 配置验证

---

## 执行摘要

Graph/Embedding 管线存在 **1 个已修复问题、2 个结构性缺陷、2 个配置/运维风险、4 个 maintenance job 缺 consumer**。其中 `entity_bridge` 语义边永远不会被创建是一个此前未被发现的设计缺陷，直接削弱了 graph retrieval 的跨类型跳转能力。

| 类别 | 数量 | 最高级别 |
|------|------|---------|
| 已修复（报告中的 P0-A） | 1 | — |
| 结构性代码缺陷 | 2 | P0 |
| 配置/运维风险 | 2 | P0 |
| Maintenance job 缺 consumer | 4 | P2 |
| 死数据/死代码 | 2 | P3 |

---

## 一、管线架构总览

### 1.1 七阶段流水线

```
[阶段1] Settlement 提交
  turn-service / thinker-worker 完成 projection
  → appendEpisodes / appendCognitionEvents 产出 changedNodeRefs
        ↓
[阶段2] Job 入队
  enqueueOrganizerJobs() 将 changedNodeRefs 按 50 个一组分 chunk
  → 写入 PG job queue，jobType = "memory.organize"
        ↓
[阶段3] Consumer 启动
  PgJobRunner 以 25ms 间隔 poll jobs_current 表
  → 启动条件取决于运行角色和配置
        ↓
[阶段4] Worker 执行
  registerWorker("memory.organize") 的回调函数
  → 构造 GraphOrganizerJob → memoryTaskAgent.runOrganize()
        ↓
[阶段5] 向量生成与存储
  GraphOrganizer.run()
  → renderNodeContent → modelProvider.embed() → batchStoreEmbeddings
  → 写入 node_embeddings 表 + graph_nodes 影子注册
        ↓
[阶段6] 语义边链接
  EmbeddingLinker.link()
  → cosineSearch 找 top-20 邻居 → selectSemanticRelation 分类
  → upsert semantic_edges（限制: similar≤4, conflict≤2, bridge≤2）
        ↓
[阶段7] 节点评分 + 搜索投影同步
  computeNodeScore → salience / centrality / bridgeScore
  → syncSearchProjection → search_projections_* 表
```

### 1.2 涉及的数据库表

| 表 | 用途 | 写入方 | 读取方 |
|---|------|--------|--------|
| `node_embeddings` | 向量存储（pgvector） | GraphOrganizer | EmbeddingLinker, RetrievalService, Navigator |
| `semantic_edges` | 语义关系边 | EmbeddingLinker | Navigator, NodeScoring |
| `node_scores` | 节点重要性评分 | GraphOrganizer | Navigator |
| `graph_nodes` | 影子注册表 | GraphOrganizer | **无（死数据）** |
| `search_projections_*` | 全文检索索引 | GraphOrganizer | RetrievalService |

### 1.3 涉及的核心文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `graph-organizer.ts` | 285 | 主编排器 |
| `embedding-linker.ts` | 113 | k-NN + 语义边创建 |
| `embeddings.ts` | 85 | Embedding I/O 门面 |
| `organize-enqueue.ts` | 67 | Job 入队 |
| `task-agent.ts` | 1276 | 任务协调 |
| `create-app-host.ts` | 517 | Worker 注册 + Consumer 生命周期 |
| `pg-runner.ts` | 57 | Job 调度 |
| `embedding-repo.ts` (pg) | 252 | node_embeddings 读写 |
| `semantic-edge-repo.ts` (pg) | 97 | semantic_edges 读写 |
| `node-scoring-query-repo.ts` (pg) | 520 | 节点内容渲染 + 评分查询 |
| `retrieval.ts` | ~450 | 混合检索（lexical + semantic RRF） |
| `navigator.ts` | ~2600+ | Graph 遍历 |

---

## 二、运行环境实测结果

### 2.1 数据库状态

| 数据库 | 容器 | 端口 | 状态 |
|--------|------|------|------|
| `maidsclaw_jobs` | `maidsclaw-jobs-pg` (postgres:16) | 55432 | **运行中**，但 schema 从未初始化，`jobs_current` 表为空 |
| `maidsclaw_app` | `maidsclaw-app-pg` (pgvector:pg16) | 55433 | **未运行**，连接被拒绝 |

```
jobs_current:     0 行（schema 此前从未被 bootstrap）
job_attempts:     0 行
node_embeddings:  不可达（容器未运行）
semantic_edges:   不可达
graph_nodes:      不可达
node_scores:      不可达
```

**结论**：当前开发环境中，Graph/Embedding 管线**从未实际执行过任何工作**。Jobs DB 为空说明 `memory.organize` job 从未成功入队或被消费。App DB 容器未运行意味着即使有 job，也无法写入 graph/embedding 数据。

### 2.2 配置状态

| 配置项 | 来源 | 值 | 状态 |
|--------|------|---|------|
| `memory.embeddingModelId` | `config/runtime.json` + env | `bailian/text-embedding-v4` | ✅ 已配置 |
| `memory.organizerEmbeddingModelId` | `config/runtime.json` | `bailian/text-embedding-v4` | ✅ 已配置 |
| `memory.migrationChatModelId` | `config/runtime.json` | `moonshot/kimi-k2.5` | ✅ 已配置 |
| `talkerThinker.enabled` | `config/runtime.json` | `true` | ✅ 已启用 |

**配置本身是完整的**。如果应用成功启动且 App DB 可达，`memoryTaskAgent` 应不为 null，`memoryPipelineReady` 应为 true。

---

## 三、问题清单

### ★ P0-1：`entity_bridge` 语义边永远不会被创建（结构性设计缺陷）

**状态**：已确认，当前代码存在  
**影响面**：Graph/Embedding 层的核心价值之一

#### 缺陷链路

三层代码逻辑相互矛盾：

**第一层** — `EmbeddingLinker.link()` 按源 node 的类型过滤邻居（`embedding-linker.ts:50-55`）：

```typescript
const neighbors = await this.embeddings.queryNearestNeighbors(source.embedding, {
    nodeKind: source.nodeKind,  // ← 只查同类型
    agentId,
    limit: 20,
    modelId,
});
```

**第二层** — `cosineSearch` 将 `nodeKind` 转为严格 SQL 等值过滤（`embedding-repo.ts:158-161`）：

```typescript
if (options.nodeKind) {
    whereClauses.push(`ne.node_kind = $${paramIndex}`);
}
```

结果：**返回的 20 个邻居全部与 source 同类型**。

**第三层** — `selectSemanticRelationInternal` 要求 `entity_bridge` 必须跨类型（`graph-organizer.ts:163`）：

```typescript
if (sourceKind !== targetKind && similarity >= 0.78 && this.isCuratedBridgePair(...)) {
    return "entity_bridge";
}
```

`sourceKind !== targetKind` **永远为 false**，因为第一层已经保证了 target 与 source 同类型。

#### 死代码范围

以下代码全部不可达：

| 文件 | 位置 | 内容 |
|------|------|------|
| `graph-organizer.ts:163-167` | `selectSemanticRelationInternal` | `entity_bridge` 分支 |
| `graph-organizer.ts:186-203` | `isCuratedBridgePair()` | 12 种跨类型配对定义 |
| `embedding-linker.ts:89,105` | `link()` | `bridgeCount` 计数器和上限检查 |

`embedding-rebuild-pg.ts` 的重建路径虽然不传 `nodeKind`（因此能拿到跨类型邻居），但它**硬编码了边类型为 `"semantic_similar"`**（line 127），也不会创建 `entity_bridge`。

#### 影响

- **Graph 缺少跨类型桥接关系**。Entity 节点（如 "Alice"）与 Episode 节点（如 "Alice 常去花房"）之间没有语义连接。
- **Navigator 的 graph traversal 无法跨类型跳转**，削弱了"从实体找到相关事件/认知"的核心检索能力。
- **`bridgeScore` 评分永远接近 0**（`computeNodeScore` 中 `crossClusterWeight` 依赖跨类型边），节点的桥接价值被低估。

#### 修复方案

在 `embedding-linker.ts:50` 中，对邻居查询做两次：一次同类型（用于 `semantic_similar` 和 `conflict_or_update`），一次不过滤类型（用于 `entity_bridge`）。或者更简单地，不传 `nodeKind`，让所有类型的邻居都进入候选池，交由 `selectSemanticRelation` 自行分类。

---

### ★ P0-2：向量 fallback `new Float32Array([0])` 可导致 model epoch 永久损坏

**状态**：已确认，当前代码存在  
**影响面**：整个 embedding 表的完整性

#### 缺陷位置

`graph-organizer.ts:62-68`：

```typescript
const entries: OrganizerEmbeddingEntry[] = nodes.map((node, index) => ({
    nodeRef: node.nodeRef,
    nodeKind: node.nodeKind,
    viewType: "primary",
    modelId: job.embeddingModelId,
    embedding: vectors[index] ?? new Float32Array([0]),  // ← 1 维零向量
}));
```

#### 触发条件

当 `modelProvider.embed()` 返回的数组长度短于输入数组时，`vectors[index]` 为 `undefined`，fallback 生效。

当前 provider（bailian/text-embedding-v4）在正常运行时不太可能触发，但以下场景可触发：

- 替换为不保证返回数量等于输入数量的第三方 provider
- API 返回被截断的响应（网络问题、超时）
- 批次拆分后的子批次返回不完整结果

#### 后果链

分两种情况：

**情况 A — 表中已有该 model 的正确维度数据**：
`dimensionCheck` 发现 1 维 ≠ 1536 维 → 抛异常 → 当前 job 失败。
影响：该 job 内**已经写入的正常 embedding 不会回滚**（`PgTransactionBatcher.runInTransaction` 是空操作，无事务包裹）。数据不一致。

**情况 B — 表为空或该 model 无数据（冷启动）**：
`dimensionCheck` 无参照 → 返回 true → **1 维零向量被写入**。
此后，所有该 model 的正常 1536 维 embedding 都会被 `dimensionCheck` 拒绝，**整个 model epoch 永久损坏**。
只有手动调 `deleteByModel(modelId)` 才能恢复。

#### 修复方案

```typescript
// 替换 fallback 为断言
if (vectors.length !== nodes.length) {
    throw new Error(
        `embed() returned ${vectors.length} vectors for ${nodes.length} inputs`
    );
}

const entries = nodes.map((node, index) => ({
    // ... 
    embedding: vectors[index],  // 不再需要 fallback
}));
```

---

### ★ P0-3：Consumer 启动条件复杂，可能静默不启动

**状态**：配置风险，当前配置正确但易碎  
**影响面**：整条管线是否运行

#### Consumer 启动逻辑

`create-app-host.ts:403-433` 定义了 4 种角色的 consumer 启动条件：

```
worker  → 无条件启动
server  → enableDurableOrchestration === true OR talkerThinkerConfig?.enabled === true
local   → PG store 存在 AND talkerThinkerConfig?.enabled
maintenance → 永远不启动 consumer
```

#### 当前配置

`config/runtime.json` 中 `talkerThinker.enabled = true`，理论上 `server` 和 `local` 角色都能启动 consumer。但：

- 如果有人去掉 `talkerThinker.enabled` 而不加 `enableDurableOrchestration`，consumer 静默停止
- 没有任何启动日志或健康检查指标能直接看到"consumer 是否在 poll"
- Job 会安静地堆积在 `jobs_current` 表中，状态永远是 `pending`

#### 建议

在 consumer 启动时输出明确日志（当前没有）。在 health check 中暴露 consumer 状态和最近 poll 时间。

---

### P1-1：`memoryTaskAgent` 条件创建，null 时 worker 会抛异常

**状态**：已有防御，但依赖配置正确  
**影响面**：整条管线

#### 逻辑

`runtime.ts:1567`：

```typescript
const memoryTaskAgent = memoryEmbeddingModelId
    ? new MemoryTaskAgent(...)
    : null;
```

当 `memoryEmbeddingModelId` 为空时，`memoryTaskAgent = null`。Worker 函数在 `create-app-host.ts:83` 检查：

```typescript
if (!memoryTaskAgent) {
    throw new Error("[memory.organize] memoryTaskAgent not available ...");
}
```

Job 会进入 `failed_terminal`。

**当前配置中 `bailian/text-embedding-v4` 已设置**，此风险不活跃。但如果配置被清空，管线会静默降级（`memoryPipelineReady = false`，TurnService 中的记忆操作变为 no-op）。

---

### P1-2：入队失败被静默吞掉

**状态**：当前代码存在  
**影响面**：Job 丢失不可追踪

`turn-service.ts` 和 `thinker-worker.ts` 中，`enqueueOrganizerJobs` 的调用被 try/catch 包裹：

```typescript
} catch (enqueueErr) {
    console.warn("[...] enqueueOrganizerJobs failed (non-fatal):", enqueueErr);
}
```

在 PG 连接池耗尽、事务超时等高压场景下，organizer job **直接丢失**，不重试，不告警。120-turn 压测期间这并非不可能。

#### 建议

至少增加一个计数器/metric，追踪入队失败次数。考虑在 `strictDurableMode` 下让入队失败成为致命错误。

---

### P1-3：`embeddingModelId` 可能 fallback 为空字符串

**状态**：当前代码存在  
**影响面**：embed API 调用行为未定义

`create-app-host.ts:103-106`：

```typescript
const embeddingModelId =
    payload.embeddingModelId ??
    runtime.effectiveOrganizerEmbeddingModelId ??
    "";
```

如果三层都为空，`embeddingModelId = ""`，传给 `modelProvider.embed()` 时：
- `resolveEmbedding("")` 可能抛异常，也可能返回一个默认 provider
- 行为依赖于 model registry 实现，不可预测

#### 建议

在 `embeddingModelId` 为空时直接 throw，不要传空字符串。

---

### P2-1：4 种 maintenance job 类型无 worker 注册

**状态**：当前代码存在  
**影响面**：维护操作不可用

`MaintenanceOrchestrationService`（`maintenance-orchestration-service.ts`）会入队 4 种 job：

| Job Type | Worker 注册 | 状态 |
|----------|-----------|------|
| `search.rebuild` | ❌ 无 | 入队后直接 `failed_terminal` |
| `maintenance.replay_projection` | ❌ 无 | 入队后直接 `failed_terminal` |
| `maintenance.rebuild_derived` | ❌ 无 | 入队后直接 `failed_terminal` |
| `maintenance.full` | ❌ 无 | 入队后直接 `failed_terminal` |

与 `memory.organize` 之前遇到的问题（报告 P0-A 所述）完全相同的模式：生产者迁移了，消费者没跟上。

这些 job 不在主数据流路径上，不影响正常 turn 处理，但意味着**所有维护操作（search 重建、projection 重放、derived 数据重建）都不可用**。

---

### P3-1：`graph_nodes` 表只写不读（死数据）

`graph_nodes` 表只在 `NodeScoringQueryRepo.registerGraphNodeShadows()` 中被写入。**整个代码库没有任何 read 操作**。表结构：

```sql
CREATE TABLE graph_nodes (
    node_kind TEXT, node_id TEXT, node_ref TEXT,
    UNIQUE(node_kind, node_id)
);
```

索引 `idx_graph_nodes_kind` 从未被查询使用。可安全删除或暂缓处理。

### P3-2：Embedding view type 只用了 `primary`

Schema 允许三种 view type：`'primary'`, `'keywords'`, `'context'`。但代码中：
- `EmbeddingLinker` 硬编码 `viewType: "primary"`
- `embedding-rebuild-pg.ts` 只查 `view_type = 'primary'`
- `cosineSearch` 不过滤 `view_type`

`'keywords'` 和 `'context'` view type 从未被生成，是预留但未实现的功能。

---

## 四、检索端消费分析

### 4.1 Graph/Embedding 数据如何被检索使用

```
User Query
    ↓
localizeSeedsHybrid() [retrieval.ts:352]
    ├── Lexical 检索: search_projections_* 表全文检索
    └── Semantic 检索 (仅当 embeddingCount > 0):
        ├── 生成 query embedding
        ├── cosineSearch(node_embeddings, HNSW index)
        └── RRF 融合: 0.5×lexical + 0.5×semantic
    ↓
Navigator.explore() [navigator.ts:457]
    ├── 以 seeds 为起点做 graph traversal
    ├── 遍历 semantic_edges（queryBySource/queryByTarget）
    └── 返回 evidence paths
```

### 4.2 当 Graph/Embedding 层为空时的退化行为

1. `countNodeEmbeddings()` 返回 0 → semantic 检索分支被跳过
2. RRF 退化为纯 lexical（权重从 0.5+0.5 变为 1.0 lexical）
3. Navigator 的 seed 质量下降 → graph traversal 起点不准
4. `semantic_edges` 为空 → graph 遍历立刻终止，无路径可走
5. `node_scores` 为空 → 节点无重要性排序信号

**最终效果**：检索退化为**纯全文检索 + recency 排序**，与根因报告中描述的"检索偏 episode"表现完全吻合。

---

## 五、语义边分类规则详解

`selectSemanticRelationInternal`（`graph-organizer.ts:144-170`）的三条规则：

| 边类型 | 条件 | 上限 | 当前状态 |
|--------|------|------|---------|
| `conflict_or_update` | 同类型 + similarity ≥ 0.9 + 2+ token 重叠 | 2/node | ✅ 可达 |
| `semantic_similar` | 同类型 + similarity ≥ 0.82 + mutual top-5 | 4/node | ✅ 可达 |
| `entity_bridge` | **跨类型** + similarity ≥ 0.78 + curated pair + token 重叠 | 2/node | ❌ **不可达** |

Curated bridge pairs（`isCuratedBridgePair`，全部不可达）：

```
event ↔ entity    evaluation ↔ entity    commitment ↔ entity
fact ↔ entity     assertion ↔ entity     episode ↔ entity
```

所有合法配对都以 entity 为中心，设计意图是让 entity 成为图谱的连接枢纽。但由于 nodeKind 过滤，这些配对永远不会被评估。

---

## 六、节点评分公式

`computeNodeScore`（`graph-organizer.ts:228-259`）：

```
salience = 0.35 × recurrence         // min(1, edgeCount/10)
         + 0.25 × recency            // max(0, 1 - (now - updatedAt) / 7天)
         + 0.20 × indexPresence      // 是否在 coreMemory.index 中
         + 0.20 × persistence        // 是否已有 persisted score

centrality = semanticDegree           // Σ(边权重)
           + logicDegree              // logic_edges 计数

bridgeScore = crossClusterWeight      // 跨 cluster 边权重之和
            / totalWeight             // 所有边权重之和
```

由于 `entity_bridge` 不存在，所有边都是同类型内部的 `semantic_similar` / `conflict_or_update`，同一 topic cluster 内的节点居多 → `crossClusterWeight ≈ 0` → `bridgeScore ≈ 0`。

---

## 七、问题修复优先级与顺序

### Phase 1：基础设施恢复（前置条件）

1. 修复 Docker Desktop / 启动 `maidsclaw-app-pg` 容器
2. 确认 `jobs_current` 和 app schema 均已 bootstrap
3. 运行一次最小 turn 测试确认 `memory.organize` job 能正常入队 + 消费

### Phase 2：结构性缺陷修复

| 序号 | 问题 | 修复文件 | 修复内容 |
|------|------|---------|---------|
| 1 | `entity_bridge` 不可达 | `embedding-linker.ts:50` | 不传 `nodeKind`，或做两次查询（同类型 + 跨类型） |
| 2 | 向量 fallback 可损坏表 | `graph-organizer.ts:67` | 替换 `??` fallback 为长度断言，不匹配时 throw |
| 3 | `batchStoreEmbeddings` 无事务 | `embeddings.ts:52` | 用真实 PG 事务包裹，保证原子性 |

### Phase 3：防御性加固

| 序号 | 问题 | 修复文件 | 修复内容 |
|------|------|---------|---------|
| 4 | Consumer 启动无日志 | `create-app-host.ts:136-142` | 启动/停止时输出日志；health check 暴露 consumer 状态 |
| 5 | 入队失败静默吞掉 | `turn-service.ts`, `thinker-worker.ts` | 增加 metric 计数器；`strictDurableMode` 下改为 throw |
| 6 | `embeddingModelId` 空字符串 | `create-app-host.ts:103` | 为空时 throw 而非传空 |
| 7 | 4 种 maintenance job 无 worker | `create-app-host.ts` | 注册 worker 或移除 enqueue 路径 |

### Phase 4：验证

5. 重跑 120-turn 测试，确认：
   - `node_embeddings` 行数随 turn 增长
   - `semantic_edges` 包含 `semantic_similar`、`conflict_or_update`、**`entity_bridge`** 三种类型
   - `node_scores` 的 `bridge_score` 不再全为 0
   - 检索结果中出现跨类型 graph traversal 路径

---

## 八、完整注册表对照（Job 类型 × Worker 注册 × 入队方）

| Job Type | Worker 注册 | 入队方 | Max Attempts | Concurrency |
|----------|-----------|--------|-------------|------------|
| `cognition.thinker` | ✅ `create-app-host.ts:57` | turn-service, thinker-worker, sweeper | 3 | 4 global |
| `memory.organize` | ✅ `create-app-host.ts:81` | turn-service, thinker-worker | 4 | 2 global |
| `search.rebuild` | ❌ | MaintenanceOrchestrationService | 3 | 1 global |
| `maintenance.replay_projection` | ❌ | MaintenanceOrchestrationService | 2 | 1 global |
| `maintenance.rebuild_derived` | ❌ | MaintenanceOrchestrationService | 3 | 1 global |
| `maintenance.full` | ❌ | MaintenanceOrchestrationService | 1 | 1 global |
| `memory.migrate` | ❌ | **无入队方** | 2 | 1/agent/session |
| `task.run` | ❌ | **无入队方** | 1 | 1/parent |

---

## 九、与根因报告（2026-04-15）的对照

| 根因报告断言 | 当前代码状态 | 说明 |
|-------------|------------|------|
| P0-A：`memory.organize` worker 未注册 | **已修复** | `create-app-host.ts:81` 已注册 |
| P0-B：`episode:0` 传播到 changedNodeRefs | **已修复** | `if (episodeId <= 0) return` 防御已加 |
| P0-C：Settlement replay 缺幂等 | 需进一步确认 | 本次审计范围外 |
| P1-A：`request_id` 未透传 | 需进一步确认 | 本次审计范围外 |
| P1-B：Query rewrite 无跨轮指代 | 未变化 | 本次审计范围外 |

### 本次审计新发现

| 新发现 | 级别 | 根因报告中 |
|--------|------|-----------|
| `entity_bridge` 永远不可达 | P0 | ❌ 未提及 |
| 向量 fallback 可损坏 model epoch | P0 | ❌ 未提及 |
| Consumer 启动条件复杂且无日志 | P0 | ❌ 未提及 |
| 4 种 maintenance job 无 worker | P2 | ❌ 未提及 |
| `batchStoreEmbeddings` 无事务保护 | P1 | ❌ 未提及 |
| `graph_nodes` 表为死数据 | P3 | ❌ 未提及 |

---

*本报告基于 `D:\Projects\MaidsClaw` 代码库静态分析、`maidsclaw_jobs` 数据库实测（端口 55432）、以及 `config/runtime.json` 配置验证。`maidsclaw_app` 数据库（端口 55433）因容器未运行而无法查询，graph/embedding 表的实际行数未知。*
