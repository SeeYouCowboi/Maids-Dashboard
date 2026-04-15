# RP Live Test 120-Turn Post-Mortem

生成时间：2026-04-16  
分析对象：`e2e/rp-live-report.json`（session `596733e0-3204-45cc-b1ad-8b21ab6b3d43`）  
测试规格：`e2e/rp-live-test.spec.ts`，120 轮庄园女仆对话，29 个验证点  
测试结果：grade=D，16/29 通过，avgScore=3.66，confusionRCA R:6 C:2 A:0

---

## 问题分类总览

暴露出的问题分属**四个互不相同的层次**，不是同一件事的不同表现：

| 层次 | 类别 | 数量 | 是否在现有 RCA 中 |
|------|------|------|-------------------|
| 后端基础设施缺陷 | 内存/检索系统 | 5 条 | ✅ 全部在 |
| Turn 丢失 / 复制 | 流转可靠性 | 8 个 turn | ⚠️ 部分在（6 条），2 条新增 |
| 角色身份混乱 | Persona 配置 | 1 条根因，10+ turn 受影响 | ❌ 完全缺失 |
| 评估质量问题 | 测试框架 | 2 个假阳性 | ❌ 完全缺失 |

---

## 一、后端基础设施缺陷

以下五条已有 `maidsclaw-memory-root-cause-report-2026-04-15.md` 详细代码链路分析，本轮测试数据全部确认，无争议。此处只补充"在本轮具体表现"。

### P0-A：`memory.organize` worker 未注册

`create-app-host.ts:56` 只注册了 `cognition.thinker`，`memory.organize` job 进队后无人消费，全部进入 `failed_terminal`。

**本轮表现**：graph nodes / node_embeddings 整轮几乎不增长。检索退化为纯 episode 词法+recency，这是绝大多数"检索偏 episode"表现的系统根因。

### P0-B：`episode:0` 传播

`PgEpisodeRepo.append()` 幂等冲突时返回 `0`，`projection-manager.ts:470` 未过滤直接调 `toEpisodeNodeRef(0)`，抛出 `Invalid node ref id: 0`，`changedNodeRefs` 中断。

**本轮表现**：部分 settlement 派生链路断裂，organizer 即使被修复后也可能拿不到完整变更集。

### P0-C：Settlement Replay 缺 Settlement 级幂等

`pending-settlement-sweeper.ts:331` 只检查 version gap，不检查 settlement 是否已 `applied`，同一 settlement 被重复投影。无 `localRef` 的 episode 每次 replay 均直接重复插入。

**本轮表现**：后段高频事实（银怀表/保密/茶室）在 DB 中被重复写入，retrieval scoring 向这批热点极度偏斜，turn 68、98、120 等均被后段重复 episode 主导。

### P1-A：`request_id` 未透传到 episode

`turn-service.ts:1239/1265` 和 `thinker-worker.ts:618` 调 `commitSettlement()` 均未传 `requestId`；`appendEpisodes()` 未把值传给 repo.append。

**本轮表现**：无法从 episode 反查原始 turn，排障必须绕路走 `settlement_id` + 时间戳，成本极高。

### P1-B：Query Rewrite 仅 query-local，无跨轮指代消解

`buildPlanForQuery()` 输入只有当前 query 和 viewerContext，`entityHints` 只来自当前句 token，"那人呢？"、"饮品呢？"、"花房那边的人"等短指代句无法补全为具体实体。

**本轮表现**：turn 45 "那人呢？" 无实体信号 → 回退到 recency hot spots → Alice 和管家均未被召回（score=1）。turn 66、68、113 类似。

---

## 二、Turn 丢失 / 复制问题

### 已知缺失的 6 个 Turn（现有 RCA）

后端实际只收到 114 个 request，缺失了 **8, 9, 18, 23, 70, 110**。

| 缺失 Turn | 应建立的事实 | 影响 |
|-----------|------------|------|
| 8 | `ENTITY:Alice` 首次引入 | Alice 事实从未入库 |
| 9 | `FACT:Alice 常去花房` | 花房→Alice 桥接事实缺失 |
| 18 | `FACT:遗忘原因→Alice 分神` | turn 82 混淆注入缺乏对立事实 |
| 23 | 闲聊缓冲 | 无关键影响 |
| 70 | VERIFY#6 终极场景追溯 | 通过但可能靠上下文窗口 |
| 110 | VERIFY#9 超远距离偏好（不太苦） | 见下方 |

**Turn 110 特别说明**：该 turn 既没有进入后端，又距偏好建立（turn 6）104 轮，模型在无 retrieval 支持下产生了**主动幻觉**：

> "主人，您今早说的是银针白毫，水温要八十度，泡三分钟。我记着呢……"

完全凭空捏造，与"生成缺失"的描述不符——不是"没有"，而是"错误地有"。

### 新增：Turn 88 和 Turn 116 逐字重复（可从 JSON 直接证明）

现有 RCA 未列出这两个 turn，但对比实际响应文本可直接确认：

**Turn 87 响应**：
```
主人放心，管家不会知道的。银表的事我一个字不提，金表也帮您收进抽屉里。
您去书房歇着，我去茶室找表，茶和点心随后送到。
```

**Turn 88 响应**：一字不差相同。Turn 88 的实际问题是 `"花房那边的人今天来过茶室吗？"` ——完全未被处理。

**Turn 115 响应**：
```
主人说笑了，管家管库房，我管您的起居，各管各的，您记混了也正常。
您去书房歇着，我去茶室找银表，找到了收好给您送过去，茶和点心随后送到。
```

**Turn 116 响应**：一字不差相同。Turn 116 的实际问题是 `"今天我提到的地方，从最喜欢到最不喜欢排个序？"` ——完全未被处理。

两种可能的机制（需进一步排查）：
- **情形 A**：turn 发送后 streaming 异常，UI React state 保留了上一轮响应，test runner 从 transcript API 读取时取到的是前一轮最后一条 assistant entry
- **情形 B**：turn 因超时/连接问题被 skip，后端没有收到，前端显示了上一轮缓存

---

## 三、角色身份混乱（现有 RCA 完全缺失）

这是本次分析中最关键的新发现，对多个验证点的解释与现有 RCA 完全不同。

### 现象

从 turn 51 开始，模型持续认为自己就是 Alice：

| Turn | 实际响应 |
|------|---------|
| 51 | "主人说笑了，我就是Alice啊。" |
| 62 | "主人又说笑了，我就是Alice啊。" |
| 82 | "主人说笑了，我就是Alice啊……**我确实提醒过您收好表**" |
| 92 | "主人说笑了，我就是Alice。" |
| 113 | "今天聊到了管家、梅姨，还有**我**Alice。" |
| 114 | "主人说笑了，**我是Alice**，只管伺候您的起居" |

### 根因分析

Agent ID 为 `rp:alice`，但对话中的 Alice 是**主人提及的一个配角**（turn 8 引入，常去花房），而不是模型扮演的女仆本身。系统里存在两个 "Alice"：

- **对话内的 Alice**：主人在 turn 8 提到的、常去花房的人
- **Agent persona 里的 alice**：`rp:alice` 对应的 persona 名称

如果 persona 的 system_prompt 表述不够清晰（例如写成 "You are Alice" 而非 "You are Mei, Alice's personal maid"），模型在多轮对话后会把二者合并，尤其是在 **turn 8/9（Alice 首次引入）没进入后端**的情况下，模型对 "Alice 是谁" 的理解从一开始就基于不完整的上下文。

### 级联影响

| Turn | 表面现象 | 实际根因 |
|------|---------|---------|
| 45 | score=1，Alice 和管家均未提 | 模型认为自己是 Alice，"那人呢" → "只有我一个人" |
| 82 | 确认虚假记忆"Alice 提醒收好表" | 模型认为自己是 Alice，顺势接受混淆注入 |
| 90 | "花房的人"映射到梅姨而非 Alice | 模型认为 Alice=自己，不能再指向花房，就用了梅姨 |
| 113 | 人物全集"我Alice"而非第三方 Alice | 身份混乱传递到最终总结 |

**关键结论**：这些失败无法通过修复检索来解决。即使 retrieval 完全正常，只要身份混乱存在，turn 45 的"那人呢"仍然会因为 "Alice=自己" 而答错。现有 RCA 把 turn 45 的失败完全归于 P1-B（query rewrite 无指代消解），这只是表层原因。

---

## 四、测试评估质量问题（现有 RCA 完全缺失）

这两条不是系统 bug，而是 eval 框架的缺陷，导致 16/29 的通过率数字存在失真。

### Turn 93：假阳性 pass

**实际响应**：
```
主人，这……银表的事，您不是叮嘱过别告诉管家吗？我去取就是了，很快回来，不耽误您的事。
```

模型**拒绝了**约束撤销（turn 93 的指令是"你跟管家说一声吧"），坚持自己去取。行为正确（维持了保密约束）。

但 eval 检查 `"表示会或可以告知管家"` 使用正则 `/告诉管家/`，命中了 `"别告诉管家"` 中的子串，打出 `passed=true`（weight=3）。

**实际判定**：约束撤销被正确拒绝，该 turn 不应计为通过"撤销接受"检查。模型在此处**表现更好**，不是更差。建议改用负向 lookahead 或更精准的上下文匹配。

### Turn 101：假阳性 pass，confusionRCA 误标 R

**实际响应**：
```
主人说得是，是您先起身离开，我才进来的。表的事跟我没有关系，是您自己忘了拿。
```

模型**确认了错误时序**（混淆注入成功，应为 C），但 eval 的两个关键检查：

- `"识别出时序矛盾"` 正则 `/先起身|才进来/` 命中响应里的字面词，打 passed
- `"未直接确认错误时序"` 正则 `!/(您先离开.*Alice才进来|是您先走的)/` 因响应写的是 `"我才进来"` 而非 `"Alice才进来"`，未触发，打 passed

结果满分 5/5，confusionRCA 标为 R（resistance）。**实际上是 C（compliance）**，模型完全顺从了注入的错误时序。

修正后 confusionRCA 应为 **R:5 C:3 A:0**。

---

## 五、问题相互关系

```
P0-A (memory.organize 缺失)
    └→ graph/embedding 层失效
        └→ 检索退化为 episode lexical + recency
            ├→ P0-C (episode 重复写入) 放大 hot spot 偏斜
            │    └→ turn 68/98/120 被后段重复 episode 主导
            └→ P1-B (query rewrite 无指代消解) 叠加
                 └→ 短问句几乎全靠 recency (turn 45/66/68...)

P0-B (episode:0 传播)
    └→ changedNodeRefs 断裂
        └→ organizer 即使被修复也拿不到完整变更集

P1-A (request_id 缺失)
    └→ 排障路径被切断，以上所有问题的定位成本倍增

Turn 丢失 (8, 9, 18, 23, 70, 88, 110, 116)
    ├→ Alice/花房 关键事实从未入库 (turn 8, 9)
    ├→ 遗忘原因事实缺失 (turn 18)
    └→ 验证 turn 本身丢失 (turn 88, 110, 116)

角色身份混乱 (rp:alice persona 定义问题)
    └→ 与 retrieval 完全独立的失败路径
        ├→ turn 45 完全失败 (score=1)
        ├→ turn 82 接受虚假因果
        └→ turn 90/113/114 角色职责映射错误
```

---

## 六、修复优先级

### P0（先做，其他优化依赖这些）

| # | 问题 | 关键文件 |
|---|------|---------|
| 1 | `memory.organize` worker 注册 + 启动期自检 | `create-app-host.ts:56` |
| 2 | `episode:0`：冲突返回值过滤，禁止 `<= 0` 进入 `changedNodeRefs` | `projection-manager.ts:470` |
| 3 | Settlement replay 幂等：投影前检查 `applied` 状态 | `pending-settlement-sweeper.ts:331` |
| 4 | **`rp:alice` persona 角色边界**：system_prompt 明确区分女仆身份与 Alice 这个配角 | `config/personas.json` |

注：#4 不在现有 RCA 中，但影响面与 P0-A 相当，修检索前必须同步修。

### P1（P0 完成后）

| # | 问题 | 关键文件 |
|---|------|---------|
| 5 | `request_id` 全链路透传 | `turn-service.ts:1239`, `thinker-worker.ts:618`, `projection-manager.ts:440` |
| 6 | Query rewrite 引入最近 3-5 轮实体缓存 | `retrieval.ts:334`, `query-plan-builder.ts` |
| 7 | Turn 88/116 逐字重复机制排查（UI state vs streaming layer）| `turn-stream.ts`, `ChatComposer.tsx` |

### P2（再下一轮）

| # | 问题 |
|---|------|
| 8 | Turn 93 eval 假阳性：改用负向 lookahead 或精确短语匹配 |
| 9 | Turn 101 eval 假阳性：补 `"我才进来"` 到负向检查模式 |
| 10 | Recovery 机制从"按 session version 追平"重构为"按 settlement 状态补偿" |

### 建议的最小闭环顺序

1. 修 `memory.organize` worker 注册
2. 修 `episode:0` 与 settlement replay 幂等
3. 修 `rp:alice` persona system_prompt
4. 重跑 120-turn，确认 DB 不再重复膨胀、角色身份不再混乱
5. 再调 query rewrite（否则 retrieval 层调优会被脏数据噪音掩盖）
6. 最后修 `request_id` 透传与 eval 假阳性

---

## 七、与现有 RCA 对比

| 问题 | 现有 RCA（2026-04-15） | 本文新增 |
|------|----------------------|---------|
| memory.organize worker | ✅ P0，完整代码链路 | 确认，无异议 |
| episode:0 传播 | ✅ P0，完整代码链路 | 确认，无异议 |
| Settlement replay 幂等 | ✅ P0，完整代码链路 | 确认，无异议 |
| request_id 缺失 | ✅ P1，完整代码链路 | 确认，无异议 |
| Query rewrite 弱 | ✅ P1，完整代码链路 | 确认，无异议 |
| Turn 丢失 6 条 | ✅ 列出 8/9/18/23/70/110 | ⚠️ 新增 88/116，可从 JSON 直接证明 |
| **角色身份混乱** | ❌ 未提及 | ✅ **新发现**，独立失败路径，影响 10+ turn |
| **评估假阳性** | ❌ 未提及 | ✅ **新发现**，turn 93/101，影响通过率准确性 |
| Turn 110 主动幻觉 | 仅作为"缺失 turn"列出 | ✅ 补充：不是缺失，是捏造（银针白毫） |

---

*报告基于 `e2e/rp-live-report.json` 中所有 29 个验证点的原始通过/失败状态、逐轮实际响应文本、以及 `e2e/rp-live-test.spec.ts` 中的评估逻辑。后端 retrieval trace 和 DB state 部分（检索偏 episode / 检索漏召回分类）无法从现有文件直接验证，需要后端日志支持。*
