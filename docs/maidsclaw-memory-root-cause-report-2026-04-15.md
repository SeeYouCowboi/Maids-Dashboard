# MaidsClaw 数据库与记忆召回问题根因报告

生成时间：2026-04-15  
分析对象：`D:\ACodingWorkSpace\MaidsClaw` 代码库  
报告落盘位置：当前文件位于 `Maids-Dashboard/docs/`，因为当前会话对 `MaidsClaw` 仓库是只读分析、对 `Maids-Dashboard` 仓库可写。

## 范围与结论

这份报告对应以下 5 个问题：

1. `No worker registered for job type: memory.organize`
2. 部分 job 带 `Invalid node ref id: 0`
3. `private_episode_events` 出现明显重复
4. `private_episode_events.request_id` 全空，无法反查 request
5. 短问句、指代问句的 query rewrite 很弱，召回经常偏向泛化片段

结论不是单点 bug，而是几条链路同时失配：

- durable job 的 `memory.organize` 已经会入队，但没有真正注册 worker 消费。
- thinker replay / recovery 会导致同一 settlement 被再次投影，episode 幂等又只覆盖一部分情况。
- projection 层把 episode insert 冲突返回的 `0` 当成真实主键继续下游传播，触发 `episode:0`。
- `request_id` 字段在 schema 和 repo 层都已存在，但 projection 调用链没有把值传下去。
- query rewrite 已经接入检索主链，但它做的是“浅层 deterministic prefix enrichment”，并不做跨轮次指代消解。

还要加一个测试样本层面的事实：这一轮 120 turn 脚本里，后端实际只收到 114 个 request，缺失了 `8, 9, 18, 23, 70, 110`。所以像 `Alice / 花房 / 饮品偏好` 这类失败，不能全部归因于 retrieval，本身就有源事实没入库的问题。但即使把这层噪音扣掉，下面 5 条代码层根因依然成立。

## 1. `No worker registered for job type: memory.organize`

### 现象

数据库里 `memory.organize` job 进入了 `failed_terminal`，错误信息是：

```text
No worker registered for job type: memory.organize
```

### 代码链路

- `turn-service` 在同步 RP turn 提交完成后会把 `changedNodeRefs` 入队为 organizer job。见 [turn-service.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/turn-service.ts:1004)。
- `thinker-worker` 在异步 thinker projection 完成后也会做同样的入队。见 [thinker-worker.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/thinker-worker.ts:854)。
- 实际入队逻辑在 [organize-enqueue.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/organize-enqueue.ts:29)，`jobType` 明确就是 `memory.organize`。
- PG job runner 在取到 job 以后，会查本地注册表；如果没有 worker，就直接 fail，并写出这条错误。见 [pg-runner.ts](/D:/ACodingWorkSpace/MaidsClaw/src/jobs/pg-runner.ts:21) 和 [pg-runner.ts](/D:/ACodingWorkSpace/MaidsClaw/src/jobs/pg-runner.ts:41)。
- 当前 app host 只注册了 `cognition.thinker`，没有注册 `memory.organize`。见 [create-app-host.ts](/D:/ACodingWorkSpace/MaidsClaw/src/app/host/create-app-host.ts:56)。
- 老的 in-process organizer 还存在于 `MemoryTaskAgent` 里，说明系统处于“旧路径还在，新 durable consumer 没补齐”的中间状态。见 [task-agent.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/task-agent.ts:670)。

### 为什么这种事情会发生

这类问题通常出现在“生产者先迁移、消费者后迁移”的半完成重构里。

这里的设计方向很明显：团队已经决定把 organizer 从旧的后台 fire-and-forget 迁到 durable job queue。代码里能看到三件事已经发生了：

- `memory.organize` 成为了正式 job kind。
- job builder、concurrency key、queue persistence 都已经有了。
- turn path 和 thinker path 都已经开始 enqueue。

但消费者侧还停留在“只接 thinker worker”的状态。也就是说，系统从架构上已经相信“organizer 是队列驱动的”，但运行时并没有真正把 organizer worker 挂进去。

### 为什么在这轮测试里表现得这么明显

因为你这轮是高 turn 压测。turn 多意味着：

- `changedNodeRefs` 多；
- organizer job 数量多；
- 每个 settlement 都会尝试异步派生 graph / embedding / semantic edges；
- 一旦 organizer 完全不消费，图谱层和 embedding 层就会快速与 episode/cognition 主表脱钩。

这正好解释了你看到的现象：

- `private_episode_events` 和 `search_docs_episode` 在增长；
- `private_cognition_current` 和 `search_docs_cognition` 在增长；
- 但 `graph_nodes` / `node_embeddings` 基本不跟着这一轮会话一起增长。

### 风险

- graph retrieval 事实上被掐断。
- assertion / relation / embedding 相关能力召回极弱。
- 后续所有依赖 organizer 派生层的模块都会呈现“主表有数据，二级索引/图谱没有”的错觉。

### 优化与解决方案

短期修复：

- 在 PG worker 启动入口补上 `memory.organize` 的 `registerWorker(...)`。
- 直接复用现有 [graph-organizer.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/graph-organizer.ts:10) 能力，不要再造一套并行实现。
- 启动时做 worker registration 自检，如果 `jobPersistence` 允许 enqueue `memory.organize`，但 consumer 未注册，应在启动期 fail fast，而不是等 job 跑到队列里才报错。

中期优化：

- 把 job kind 与 worker registration 做成一份显式清单，避免“代码里能 enqueue、运行时却没人消费”。
- 为 `memory.organize` 增加健康检查指标，例如 `pending age`、`failed_terminal count`、`registered worker set`。

建议优先级：`P0`。这条不修，图谱与 embedding 层基本就是失效状态。

## 2. 部分 job 带 `Invalid node ref id: 0`

### 现象

你看到的报错是：

```text
Invalid node ref id: 0
```

### 代码链路

这个精确文案最直接来自 [schema.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/schema.ts:22)：

```ts
export function makeNodeRef(kind: NodeRefKind, id: number): NodeRef {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid node ref id: ${id}`);
  }
}
```

触发路径是 episode projection：

- `ProjectionManager.appendEpisodes()` 调 `episodeRepo.append(...)`。见 [projection-manager.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/projection/projection-manager.ts:440)。
- `PgEpisodeRepo.append()` 在 `(settlement_id, source_local_ref)` 冲突时执行 `DO NOTHING`，并在 `RETURNING id` 为空时返回 `0`。见 [episode-repo.ts](/D:/ACodingWorkSpace/MaidsClaw/src/storage/domain-repos/pg/episode-repo.ts:80) 和 [episode-repo.ts](/D:/ACodingWorkSpace/MaidsClaw/src/storage/domain-repos/pg/episode-repo.ts:87)。
- 但 `ProjectionManager.appendEpisodes()` 没有把 `0` 当成“这条没插入”，而是继续调用 `toEpisodeNodeRef(episodeId)`。见 [projection-manager.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/projection/projection-manager.ts:470)。
- `toEpisodeNodeRef(0)` 内部会走 `makeNodeRef("episode", 0)`，于是抛出 `Invalid node ref id: 0`。见 [projection-manager.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/projection/projection-manager.ts:97)。

### 为什么这种事情会发生

这是一个典型的“repo 层用 sentinel value 表示冲突跳过，但上层没遵守协议”的问题。

`PgEpisodeRepo.append()` 的返回语义实际上已经不是“永远返回有效主键”，而是：

- `> 0`：真的插入成功；
- `0`：因为幂等冲突被跳过，没有新行。

但 projection 层仍然按“append 一定返回可用 id”的旧假设在写逻辑，所以一旦碰到冲突，就会把“没有写入”误当成“写入了第 0 号 episode”。

### 为什么在这轮测试里会出现

因为你这轮里 settlement replay 很明显，重复执行同一个 settlement 的概率升高。只要 replay 时 episode 带了同样的 `source_local_ref`，第一次写入成功，后面就会走 `ON CONFLICT DO NOTHING -> return 0 -> makeNodeRef(0)`。

也就是说，这条错误不是独立 bug，它是“重复投影”与“返回值协议不一致”叠加后的副产物。

### 风险

- `changedNodeRefs` 中断，organizer 后续拿不到完整变更集。
- thinker worker 可能被非预期地打断或进入失败重试。
- 一部分 settlement 会表现为“主表部分写入成功，但派生链路被 0 打崩”。

### 优化与解决方案

短期修复：

- 把 `episodeRepo.append()` 的返回类型改成 `number | null`，或者显式结果对象，如 `{ inserted: boolean, id?: number }`。
- 在 [projection-manager.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/projection/projection-manager.ts:470) 处，如果 append 结果为 `0` / `null`，直接跳过 `changedNodeRefs.push(...)`。

中期优化：

- 全库统一“幂等跳过”的返回协议，不要有的 repo 返回 `0`，有的返回 `null`，有的抛异常。
- 对 `changedNodeRefs` 的构造增加防御性校验，禁止 `<= 0` 的 id 进入派生链。

建议优先级：`P0`。这条会直接把重复场景中的 projection 链路炸掉。

## 3. `private_episode_events` 出现明显重复

### 现象

你看到的不是普通的“不同 turn 写了相似 summary”，而是：

- 同一 session 的 episode 数量明显高于预期；
- 不同 summary / settlement 去重后，重复度异常高；
- 某些 settlement 被重复回放到更晚时间。

### 代码链路

这件事不是单点 SQL bug，而是三层共同导致的：

第一层，episode 幂等只覆盖“有 `source_local_ref` 的情况”。

- 表插入使用 `(settlement_id, source_local_ref)` 唯一约束，并且只有 `source_local_ref IS NOT NULL` 时生效。见 [episode-repo.ts](/D:/ACodingWorkSpace/MaidsClaw/src/storage/domain-repos/pg/episode-repo.ts:80)。
- 但 `PrivateEpisodeArtifact.localRef` 是可选字段。见 [rp-turn-contract.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/rp-turn-contract.ts:123)。
- 所以没有 `localRef` 的 episode，即使内容完全一样，只要 settlement 再投影一次，就会再次插入。

第二层，thinker recovery 以“version gap”为准，而不是“settlement 已处理完毕”为准。

- talker 每 turn 会先把 `talker_turn_counter` 加 1。见 [turn-service.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/turn-service.ts:628)。
- sweeper 会扫描 `talker_turn_counter > thinker_committed_version` 的 session。见 [pending-settlement-sweeper.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/pending-settlement-sweeper.ts:271)。
- 恢复逻辑只检查是否存在 `pending/running` 的 thinker job，不检查 settlement 是否已经 `applied`。见 [pending-settlement-sweeper.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/pending-settlement-sweeper.ts:331)。

第三层，thinker worker 的幂等保护依赖 slot version，而不是 settlement 粒度的强幂等。

- 开头只做 `slot.thinkerCommittedVersion >= payload.talkerTurnVersion` 的版本比较。见 [thinker-worker.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/thinker-worker.ts:342)。
- 之后就直接做 projection，再尝试 `markThinkerProjecting` / `markApplied`。见 [thinker-worker.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/thinker-worker.ts:637) 和 [thinker-worker.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/thinker-worker.ts:804)。

### 为什么这种事情会发生

根上是“系统使用了版本推进来近似 settlement 幂等”，但二者并不等价。

版本推进只能回答：

- thinker 目前大概追到第几轮了；

它不能回答：

- 某个具体 settlement 是否已经成功且完整地投影过；
- 这个 settlement 是否需要 replay；
- replay 时哪些 side effect 应该跳过，哪些应该补偿。

一旦 recovery 逻辑只认版本、不认 settlement 实际完成状态，就会出现：

- 同一 settlement 被重新跑；
- 有 `localRef` 的 episode 在 repo 层冲突跳过；
- 没 `localRef` 的 episode 直接重复写；
- 派生链路一部分成功、一部分炸在 `episode:0`。

### 为什么在这轮测试里会被放大

因为高 turn 压测会把 thinker 落后、补偿、split batch、异步 projection 的问题全部放大。代码里还能看到 thinker 有 batch split 路径，会把 backlog 拆成多个 job 并行追赶，[thinker-worker.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/thinker-worker.ts:428)。这种场景对 settlement 级幂等要求更高，一旦幂等设计不够硬，就容易在回放链上产生重复写入。

### 风险

- episode 侧出现后段事实过度加权。
- 检索分布向“被重复写过的近期片段”偏斜。
- `summary` 相似度高的热点事实会在 recall 中不断胜出。

### 优化与解决方案

短期修复：

- 强制要求 thinker 产出的 `privateEpisodes` 一律带稳定 `localRef`。
- 对 episode 增加更强的 settlement 内幂等键，例如 `(settlement_id, summary_hash, category)` 作为兜底去重，不依赖 `localRef` 是否存在。
- 在 thinker recovery 前先查 settlement ledger，如果该 settlement 已 `applied`，不要因为 version gap 再次重跑。

中期优化：

- 把 recovery 设计从“按 session 版本追平”改成“按 settlement 状态机补偿”。
- 把投影结果做成可重放但幂等的事件应用器，每个 side effect 都要有独立幂等键。
- replay 时分清“补偿缺失派生”和“重做整次 settlement”。

建议优先级：`P0`。这条不修，DB 越跑越偏，retrieval 也会越来越偏。

## 4. `private_episode_events.request_id` 全空

### 现象

表里有 `request_id` 字段，但本轮 episode 记录全是空值，因此无法直接从 episode 反查原始 request。

### 代码链路

这里的问题不是表结构缺字段，而是值没有沿着调用链传下去。

已有能力：

- `SettlementProjectionParams` 明确支持 `requestId?: string`。见 [projection-manager.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/projection/projection-manager.ts:264)。
- cognition event / projection 已经会写 `request_id`。见 [projection-manager.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/projection/projection-manager.ts:590) 和 [projection-manager.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/projection/projection-manager.ts:611)。
- episode repo insert 也支持 `requestId`。见 [episode-repo.ts](/D:/ACodingWorkSpace/MaidsClaw/src/storage/domain-repos/pg/episode-repo.ts:78)。

真正断掉的地方有两处：

- turn-service 在调用 `projectionManager.commitSettlement(...)` 时没有传 `requestId`。见 [turn-service.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/turn-service.ts:1239) 和 [turn-service.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/turn-service.ts:1265)。
- thinker worker 构造 `SettlementProjectionParams` 时同样没有把 `requestId` 放进去。见 [thinker-worker.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/thinker-worker.ts:618)。
- 更直接的一刀是，`appendEpisodes()` 调 repo.append 时根本没传 `requestId`。见 [projection-manager.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/projection/projection-manager.ts:440)。

另一个细节是 thinker worker 甚至把 `AgentRunRequest.requestId` 设成了 `payload.settlementId`，不是原始 request id。见 [thinker-worker.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/thinker-worker.ts:588)。这进一步说明当前系统里 request correlation 在 thinker 链路上已经有语义漂移。

### 为什么这种事情会发生

这是典型的“schema 先行、链路后补、最后忘了接完”的问题。

团队显然已经意识到 request correlation 很重要，所以：

- schema 加了 `request_id`；
- repo 接口加了 `requestId`；
- 一部分 cognition 路径也在写这个值。

但 episode projection 这条链没有完全跟进。结果就是：

- 从表设计上看，好像支持追踪；
- 从运行结果看，episode 仍然不可追踪。

### 为什么这会影响排障

因为 episode 是 retrieval 的主要数据面。你现在最需要的就是：

- 一条 episode 来自哪个 request；
- 它是首写还是 replay；
- 它与 interaction trace 的哪条 chunk / settlement 对应。

如果 `request_id` 为空，排障就必须绕路走 `settlement_id`、`committed_time`、interaction 侧 payload 反查，成本高很多。

### 优化与解决方案

短期修复：

- `turn-service` 在 `commitSettlement()` 参数里补 `requestId`。
- `thinker-worker` 用原始 request id，而不是 `settlementId` 伪装成 `requestId`。
- `ProjectionManager.appendEpisodes()` 把 `params.requestId` 传给 repo.append。

中期优化：

- 统一 request correlation 语义：`request_id` 永远指原始 turn request，`settlement_id` 永远指本次 memory settlement。
- 在 episode、cognition、search_docs、jobs payload 里保持同一套 correlation 字段，方便横向追踪。
- 给 replay 额外加 `origin_settlement_id` 或 `replayed_from_job_key`，不要靠时间戳猜。

建议优先级：`P1`。它不一定直接导致错误，但会严重拉高调试成本。

## 5. 短问句 / 指代问句的 query rewrite 很弱

### 现象

像“那人呢？”、“饮品呢？”、“花房那边的人”这类 query，检索常常没有把“上文里那个实体 / 饮品 / 地点链路”补全，而是掉回近期高频 episode，例如“银怀表 / 管家保密 / 先不去茶室”。

### 代码链路

这里需要特别澄清：系统不是没有 rewrite，而是 rewrite 能力层次偏浅。

已接上的部分：

- runtime 启动时默认会构造 `RuleBasedQueryRouter` 和 `DeterministicQueryPlanBuilder`。见 [runtime.ts](/D:/ACodingWorkSpace/MaidsClaw/src/bootstrap/runtime.ts:1408) 和 [runtime.ts](/D:/ACodingWorkSpace/MaidsClaw/src/bootstrap/runtime.ts:1415)。
- retrieval 真正执行前会调用 `buildPlanForQuery()`。见 [retrieval.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/retrieval.ts:211) 和 [retrieval.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/retrieval.ts:328)。
- orchestrator 会消费 `queryPlan.surfacePlans.*.rewrittenQuery`。见 [retrieval-orchestrator.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/retrieval/retrieval-orchestrator.ts:224)。

rewrite 的实际内容：

- router 只基于当前 query 做 keyword bucket 分类与 alias resolve。见 [query-router.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/query-router.ts:173) 到 [query-router.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/query-router.ts:253)。
- builder 的 rewrite 只是把 `intent types + entityHints + normalizedQuery` 拼在一起。见 [query-plan-builder.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/query-plan-builder.ts:157) 到 [query-plan-builder.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/query-plan-builder.ts:196)。
- `entityHints` 只来自当前这句 query 里被 alias 解析出的 token。见 [query-router.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/query-router.ts:179) 和 [query-router.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/query-router.ts:421)。
- `buildPlanForQuery()` 输入只有当前 `query` 和 `viewerContext`，没有上一轮 discourse state。见 [retrieval.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/retrieval.ts:334)。

episode 侧的回退检索也比较朴素：

- 先做 lexical / embedding episode recall。见 [retrieval-orchestrator.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/retrieval/retrieval-orchestrator.ts:501)。
- 如果还不够，就走 fallback `scoreEpisodeRow()`，核心就是 token overlap、当前 area bonus、当前 session bonus。见 [retrieval-orchestrator.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/retrieval/retrieval-orchestrator.ts:720)。

### 为什么这种事情会发生

因为这套 rewrite 解决的是“查询过短、词太泛、需要补一点显式信号”的问题，不是“跨轮次指代消解”的问题。

它能做的事更像：

- “这个 query 看起来像 timeline / conflict / state”；
- “这个 query 里提到了一个能 resolve 的实体别名”；
- “给检索 query 前面加一点意图和实体提示词”。

它做不了的事是：

- “那人”指的是上一轮提到的 `Alice`；
- “饮品”指的是更早轮里提到的“别太苦的红茶”；
- “花房那边的人”要结合先前对话才能落到具体实体。

换句话说，现在的 rewrite 是 **query-local** 的，不是 **conversation-aware** 的。

### 为什么在这轮测试里表现得尤其差

因为这轮测试同时满足三件事：

- 多个关键引入 turn 没进入后端，导致某些实体本来就不在库里。
- episode 数据面出现重复，近期热点事实被过度加权。
- graph organizer 没跑起来，assertion / relation / embedding 图谱层几乎失效。

于是当 query 自身又很短时，系统几乎只能：

- 依赖表层 token；
- 依赖当前 session / 当前 area 的 recency；
- 从重复最多、最近最多的 episode 里挑。

所以“银怀表 / 管家保密 / 茶室”那批片段就特别容易赢。

### 风险

- 指代型问句几乎不可用。
- 省略型、多轮追问型体验会很不稳定。
- 测试中后段被重复写入的热点事实会越来越主导检索。

### 优化与解决方案

短期修复：

- 在 retrieval 前增加一层轻量指代补全，不必上大模型，先做最近 3 到 5 轮的实体缓存与指代回填。
- 如果 query 本身缺少有效实体词，但上一轮 assistant/user 刚刚围绕某个实体连续对话，则把该实体作为 rewrite seed 注入。
- 对短 query 启动 stricter recall 策略：减少单纯 recency 对 fallback scorer 的支配，增加 entity pointer / cognition key / relation 命中权重。

中期优化：

- 把 discourse state 纳入 `buildPlanForQuery()` 输入，不要只看当前 query 和 viewerContext。
- 对“那个人 / 那边 / 那件事 / 饮品呢”建立一套最小可用的中文指代词表和回指规则。
- 在 rewrite 阶段接入 recent cognition slot、上一轮提及实体、最近显式问答主题。

长期优化：

- 让 graph / relation / embedding 重新工作后，再把 pronoun resolution 的结果同时投给 episode、cognition、graph 三个面，而不是只改 episode query。
- 为 retrieval trace 增加“rewritten from what”字段，能直接看到系统把“那人呢”补成了什么。

建议优先级：`P1`。它和前 3 条不同，不一定是“系统坏了”，但对多轮记忆体验影响非常大。

## 为什么这些问题会一起出现

这 5 条不是孤立的，而是相互放大：

- `memory.organize` 没 worker，导致 graph/embedding 派生层缺失。
- settlement replay 让 episode 重复写入。
- episode 冲突返回 `0` 又把 projection 链路打断。
- `request_id` 缺失让排障很难证明“这条 episode 是首写还是 replay”。
- query rewrite 又缺乏跨轮指代补全，于是 retrieval 更容易被重复热点 episode 带偏。

它们共同构成了一个很典型的系统性现象：

> 主表在写，派生层在掉队；回放在发生，幂等不完整；query 又太短，最终表现成“数据库里好像有记忆，但问起来总是召回错的东西”。

## 建议的修复优先级

### P0

- 补齐 `memory.organize` worker 注册与启动期自检。
- 修正 `episodeRepo.append()` 冲突返回值的上层处理，禁止生成 `episode:0`。
- 为 thinker replay 增加 settlement 级幂等检查，避免重复投影。
- 要求 thinker 产出的 episode 一律带稳定 `localRef`，并补一个无 `localRef` 的兜底幂等键。

### P1

- 把 `request_id` 从 turn-service / thinker-worker / projection-manager 一路传到 episode。
- 为短问句增加 conversation-aware 的轻量指代补全。
- 增加 replay / first-write 追踪字段，降低排障成本。

### P2

- 把 recovery 从“按 session version 追平”重构成“按 settlement 状态补偿”。
- 把 query rewrite、recent cognition、graph seeds 纳入统一的 query planning 视图。

## 建议先做的最小闭环

如果只做一轮最小修复，我建议按这个顺序：

1. 修 `memory.organize` worker 注册。
2. 修 `episode:0` 与 settlement replay 幂等。
3. 修 episode `request_id` 透传。
4. 再重跑 120 turn，确认 DB 不再重复膨胀。
5. 最后再调 query rewrite，否则 retrieval 层调优会被脏数据噪音掩盖。

## 参考代码

- [pg-runner.ts](/D:/ACodingWorkSpace/MaidsClaw/src/jobs/pg-runner.ts:21)
- [create-app-host.ts](/D:/ACodingWorkSpace/MaidsClaw/src/app/host/create-app-host.ts:56)
- [turn-service.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/turn-service.ts:1004)
- [thinker-worker.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/thinker-worker.ts:342)
- [thinker-worker.ts](/D:/ACodingWorkSpace/MaidsClaw/src/runtime/thinker-worker.ts:618)
- [organize-enqueue.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/organize-enqueue.ts:29)
- [projection-manager.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/projection/projection-manager.ts:440)
- [schema.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/schema.ts:22)
- [episode-repo.ts](/D:/ACodingWorkSpace/MaidsClaw/src/storage/domain-repos/pg/episode-repo.ts:80)
- [pending-settlement-sweeper.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/pending-settlement-sweeper.ts:271)
- [recent-cognition-slot-repo.ts](/D:/ACodingWorkSpace/MaidsClaw/src/storage/domain-repos/pg/recent-cognition-slot-repo.ts:11)
- [retrieval.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/retrieval.ts:211)
- [query-router.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/query-router.ts:173)
- [query-plan-builder.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/query-plan-builder.ts:162)
- [retrieval-orchestrator.ts](/D:/ACodingWorkSpace/MaidsClaw/src/memory/retrieval/retrieval-orchestrator.ts:224)

