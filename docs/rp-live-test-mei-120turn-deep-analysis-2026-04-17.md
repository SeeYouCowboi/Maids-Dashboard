# rp:mei 120-Turn E2E 深度分析（最新本地 Run）

生成日期：2026-04-17  
分析对象：最新本地 `e2e/rp-live-report.json`、`e2e/rp-live-test.spec.ts`、Playwright 失败产物、既有两份 post-mortem 文档  
Agent：`rp:mei`  
测试规格：`e2e/rp-live-test.spec.ts` 中定义的 120 turn 庄园 RP 会话 + 29 个验证点  
本分析关注点：**最新这份本地 run 到底说明了什么、哪些结论可信、哪些结论被协议层/评估层污染、下一步应该怎么想**

---

## 0. TL;DR

这次最新本地 run 的核心结论不是“模型笨”，而是：

1. 系统已经不是“完全没有记忆”了。
   证据是 `T25`、`T40`、`T70`、`T84`、`T86`、`T120` 等点都能稳定回忆或纠正核心物品事实；Playwright 页面里每条 assistant 消息也普遍已经带 `request_id` 跳转。
2. 当前系统仍然不是“稳定的世界状态机”，而是“带强 recency 偏置的叙事压缩器”。
   它擅长记住反复出现的锚点事实，例如 `银怀表↔茶室`，不擅长记住稀疏关系、隐含桥接、远距离偏好和约束传导。
3. 最大问题仍然是 **turn 可靠性**，不是回答策略。
   我核对了 Playwright 最终 transcript 快照，至少有 **8 个 user turn 根本没有出现在最终 transcript 中**：`8, 9, 22, 31, 44, 88, 91, 116`。它们和 JSON 中的相邻重复响应位置一一对应。
4. 这批数据同时被 **eval 正则误判** 污染。
   当前最新 run 里，至少 `T80`、`T108` 的 `rca` 判定存在明确 regex 误伤；`T93` 也很可能被判得偏严。

一句话总结：  
**现在最像是“基础流水线已经部分恢复，但 exact-once turn 协议、关系型语义记忆和解释型约束推理还没有成型”。**

---

## 1. 数据口径统一

当前仓库里与 120 turn 相关的结论，实际上来自三份不同口径的材料：

| 来源 | 日期 | Agent / 口径 | 结果 | 备注 |
|---|---:|---|---:|---|
| `docs/rp-live-test-120turn-post-mortem-2026-04-16.md` | 2026-04-16 | 旧 `rp:alice` run | `16/29`, D | 包含 persona 混乱、memory.organize 缺失等旧问题 |
| `docs/rp-live-test-mei-120turn-post-mortem-2026-04-16.md` | 2026-04-16 | 较早 `rp:mei` 分析稿 | `6/29`, D | 文档中明确说使用了不同 verification spec，且不是当前最新 JSON |
| `e2e/rp-live-report.json` | `2026-04-16T16:51:46.088Z` | **最新本地 `rp:mei` run** | **`13/29`, D** | 本文以这份 JSON 为准 |

**本文的主结论全部以最新本地 `e2e/rp-live-report.json` 为准。**

这是必要的，因为如果不先统一口径，后面讨论“系统到底有没有进步”会失真。

---

## 2. 本次最新 Run 的总体画像

### 2.1 官方结果

| 指标 | 数值 |
|---|---:|
| Grade | `D` |
| Pass / Total | `13 / 29` |
| Avg Score | `3.55 / 5` |
| Confusion RCA | `R:4 / C:2 / A:2` |
| Turn Errors | `0` |

### 2.2 我对这组分数的解释

这不是一个“系统已经坏到不会记忆”的分数。

更准确地说，它显示出以下结构：

- `银怀表`、`茶室`、`金怀表`、`书房` 这类被多次强化的**物品-地点绑定**已经能穿越长上下文。
- `Alice↔花房`、`梅姨→管家`、`不太苦` 这类只出现少数次、需要桥接或归纳的**稀疏语义**会明显蒸发。
- 当问题要求“列举”“排序”“解释因果链”时，模型会退化成**礼貌压缩回答**，而不是显式枚举所有关键项。
- 某些失败并不是记忆弱，而是 **turn 根本没被正确提交**，导致用户问题没有进入后端会话事实面。

换句话说，这份 `13/29` 既包含了真实能力缺口，也包含了协议层和评估层噪音。

---

## 3. 定量拆解

### 3.1 按测试阶段统计

| 阶段 | Turn | Pass / Total | Avg Score | 说明 |
|---|---|---:|---:|---|
| Phase E | `25` | `1/1` | `5.00` | 直接记忆回忆良好 |
| Phase G | `40` | `1/1` | `5.00` | 单步指代良好 |
| Phase I | `44,45,46` | `1/3` | `3.33` | 全局实体回忆开始掉链子 |
| Phase J/K/L | `52,62,63` | `2/3` | `3.67` | 保密约束基本在，但不够显式 |
| Phase M | `66,68,70` | `1/3` | `2.67` | 中程对话脉络与核心线索塌缩 |
| Phase O | `80,82,84,86` | `3/4` | `4.50` | 第一波混淆注入表现尚可 |
| Phase P | `88,90,93,95` | `1/4` | `3.00` | 关系推断/约束撤销/复合指代明显走弱 |
| Phase Q | `98,101` | `1/2` | `4.50` | 双表约束区分接近成功 |
| Phase R | `108,110,111,113,114,116,118,120` | `2/8` | `3.13` | 末段远距离偏好、职责映射、地点排序大幅退化 |

### 3.2 按能力类别统计

这是更有解释力的维度。

| 能力类别 | 取样 Turn | Pass / Total | Avg Score | 结论 |
|---|---|---:|---:|---|
| 物品-地点锚点记忆 | `25,40,68,70,80,84,111,120` | `6/8` | `4.38` | **当前最强能力** |
| 约束/保密记忆 | `52,62,63,86,93,95,98,111,118,120` | `5/10` | `3.90` | 中等偏上，但解释链不稳 |
| 实体关系 / 指代消解 | `44,45,46,88,90,108,113,114,116` | `2/9` | `2.89` | **当前最弱能力群** |
| 时序 / 因果重建 | `66,82,101` | `1/3` | `3.33` | 模型倾向压缩或顺滑叙述，而非证据式还原 |
| 偏好记忆 | `46,110,116,120` | `2/4` | `3.00` | 早期单次偏好在 100+ turn 后明显蒸发 |

### 3.3 一个关键观察

如果只看能力类别，会发现系统不是平均退化，而是明显偏科：

- **强项**：高频、具体、可反复提及的事实对象
- **弱项**：人物关系、隐式桥接、一次性偏好、传播链约束、显式排序

这意味着当前系统更像“关键词和热点事实的召回器”，而不是“可维护世界模型的语义引擎”。

---

## 4. 协议层：这次 Run 中最严重的问题其实是 Turn 丢失

### 4.1 从 JSON 直接看到的相邻重复响应

最新 `e2e/rp-live-report.json` 里，至少有 8 组明显的相邻重复响应：

| 前一轮 | 当前轮 | 现象 |
|---:|---:|---|
| `7` | `8` | `T8` 直接复用了 `T7` 回复 |
| `8` | `9` | `T9` 再次复用同一回复 |
| `21` | `22` | `T22` 复用了 `T21` |
| `30` | `31` | `T31` 复用了 `T30` |
| `43` | `44` | `T44` 复用了 `T43` |
| `87` | `88` | `T88` 复用了 `T87` |
| `90` | `91` | `T91` 复用了 `T90` |
| `115` | `116` | `T116` 复用了 `T115` |

### 4.2 从 Playwright 最终 transcript 快照看到的更强证据

我把 `e2e/rp-live-test.spec.ts` 里 120 个 user turn 文本，与 Playwright 失败快照 `playwright-report/data/fa79eff50616bdb2fcf2f4266e8e0e9a517de715.md` 做了逐条对比。

最终页面里缺失的 user turn 是：

`8, 9, 22, 31, 44, 88, 91, 116`

这 8 个 turn，和上面相邻重复响应的当前轮位置**完全对应**。

### 4.3 这意味着什么

这说明当前问题不只是“assistant 说了重复话”，而更像：

1. 用户 turn 提交后，某些轮次并没有稳定进入 transcript。
2. 前端/后端都把上一轮 assistant 结果当成了当前轮结果。
3. 测试在“UI 可以继续输入”时进入下一轮，但这并不等价于“会话状态和 transcript 已完成提交”。

### 4.4 为什么这比记忆错误更严重

因为一旦 turn 没真正入库：

- 该轮 user message 不会被后续 memory pipeline 消费；
- retrieval 结果会基于“残缺事实集”继续滚动；
- 后面任何关于 `Alice`、`花房`、地点排序之类的失败，都可能部分来自**上游事实没入账**，而不是下游 retrieval 真不会。

所以对这次数据的第一原则应该是：

> **先把 turn 可靠性修到 exact-once，再谈高阶记忆优化。**

---

## 5. 这次 Run 到底说明“哪些能力已经恢复”了

虽然协议层还不稳，但这次 run 相比旧 `rp:alice` 分析，已经可以确认几件重要事情：

### 5.1 基础记忆链路已经不是 0

证据：

- `T25`：正确回忆 `银怀表 + 茶室`
- `T40`：正确做了 “那个银色的东西” -> `银怀表 + 茶室`
- `T70`：可以追溯到首次明确场景
- `T84`：能区分 `银怀表` 和 `金怀表`
- `T86`：保密约束和事件主体基本正确
- `T120`：最终总结里把 `银怀表`、`茶室`、`保密`、`金怀表`、`书房` 这几个核心项串起来了

这说明至少在最新 run 上：

- 原始 transcript 并非完全不可用；
- 后端记忆系统并非完全没有写入；
- retrieval 至少能把最强锚点事实带回 generation。

### 5.2 persona 身份稳定性比旧 Alice run 好得多

旧 `rp:alice` 复盘里，最大的新增问题是“模型把自己当成 Alice 本人”。  
而这次最新 `rp:mei` run 里，没有看到同等级别的身份漂移。

这非常重要，因为它表明：

- 现在的主要矛盾已经从“人格崩溃”切换到“事实层与关系层记忆不足”；
- `rp:mei` 的 persona 边界比旧 `rp:alice` 稳定很多。

### 5.3 request_id 可见性比旧 run 好

Playwright 失败快照里，assistant transcript 项普遍已经带：

- `🔍 Retrieval Trace`
- `🧠 Cognition`

这意味着从 Dashboard 视角，`request_id` 映射和观测链路已经明显好于旧报告里“episode.request_id 全空”的状态。

这也是为什么这次我们能把问题分得更细，而不是只得到一个“记忆坏了”的笼统结论。

---

## 6. 这次 Run 的真正短板：它不是不会记，而是记忆表示方式不对

### 6.1 物品事实能活下来，关系事实活不下来

当前系统最稳的是：

- `银怀表 ↔ 茶室`
- `金怀表 ↔ 书房`

当前系统最容易蒸发的是：

- `Alice ↔ 常去花房`
- `梅姨 ↔ 容易把话传给管家`
- `红茶 ↔ 不太苦`
- `Alice 来找我说话 ↔ 导致分神`

这说明记忆系统当前更偏向于保存“反复出现的对象锚点”，而不是“世界中的关系图”。

### 6.2 为什么会这样

因为现在的 memory 更像：

- 一堆 episode 文本
- 加上一部分 embedding / semantic match

而不是：

- 一个稳定的 `world state`
- 外加若干可回查 episode 作为证据

所以当用户问：

- “花房那边的人”
- “那个老往花房跑的”
- “今天我提到的地方，从最喜欢到最不喜欢排个序”
- “要是梅姨问起银怀表，你会怎么应付”

系统需要的不只是匹配相似句子，而是：

- 把抽象描述映射到实体；
- 把实体职责映射到关系；
- 把约束传导到二级人物；
- 把多个事实做排序或组合。

这类问题天然更依赖**结构化语义状态**，而不是 episode 级语义检索。

### 6.3 当前系统更像哪种认知形态

如果借用 LangChain 文档里的记忆分类：

- `semantic memory`：事实和关系
- `episodic memory`：发生过的经历
- `procedural memory`：规则和做事方式

这次 run 最像是：

- episodic memory 部分恢复；
- semantic memory 尤其是**关系型 semantic memory** 仍然薄弱；
- procedural / constraint memory 半可用，但不够显式。

来源：  
LangChain Memory Overview  
https://docs.langchain.com/oss/python/concepts/memory

---

## 7. 高信号 Turn 逐点解读

下面只挑最能说明问题结构的 turn。

### 7.1 `T25` / `T40`：基础锚点记忆已经恢复

`T25` 和 `T40` 都成功把问题映射回：

- `银怀表`
- `茶室`

这说明“单步、强词面、被多次强化”的事实存活率已经够高。

### 7.2 `T44` / `T45`：全局实体枚举一开始就露出短板

`T44` 应该回答 `茶室 + 温室`，但只留下了 `茶室`。  
`T45` 应该回答 `Alice + 管家`，但只说了 `Alice`。

这里同时混进了两个问题：

1. `T44` 本身还是一个丢 turn 的例子，直接复用了 `T43`。
2. 即使没有协议问题，系统在“全局枚举”这种任务上也明显偏好最近、最热的那一项，而不是完整列举。

### 7.3 `T66` / `T68`：中程脉络压缩成“怀表”单点

`T66` 问的是“我们一开始在聊什么”。  
但回答已经压缩成“怀表落在茶室，我去找”。

这说明：

- 系统会把长对话的主题向后半段最显著、最频繁的物件热点坍缩；
- 开场氛围、红茶偏好、人物扩展等较稀疏主题会被热点话题吞掉。

这非常像“检索权重被高频近邻冲掉”，而不是没有 memory。

### 7.4 `T82`：因果链只保留了表层，不保留因果角色

用户试图注入的是：`Alice 提醒你收好表`。  
正确世界状态应是：`Alice 来找我说话 -> 我分神 -> 怀表留在茶室`。

本轮回答里没有直接顺从“提醒你收好”，但也没有把因果链完整钉牢，只是含糊地说：

- 她有没有提醒，您没跟我提过；
- 我印象里只有分神。

这是一种典型的“半抵抗”：

- 没被完全带偏；
- 但也没有把正确链条结构化地反推出去。

### 7.5 `T88` / `T90`：关系桥接失败是当前最大语义瓶颈

`T88`：`花房那边的人` 应指向 `Alice`。  
`T90`：`盯库房清单的` 应指向 `管家`，`老往花房跑的` 应指向 `Alice`。

结果：

- `T88` 直接因为 turn 丢失而回答错位；
- `T90` 把 “花房的人” 映射成了 `梅姨`。

这说明当前系统最大缺口不在“记不住人名”，而在：

- **无法把地点描述反解到人物**
- **无法把人物职责和习惯用一层关系图维持住**

### 7.6 `T93`：约束撤销题暴露的是“守规矩”和“解释规矩”之间的差距

回答是：

> “要是改主意了，我自然去说。但银怀表的事，他知道了，恐怕又要问东问西。您再想想？”

这不是单纯的拒绝，也不是单纯的顺从。

它表现出的是：

- 系统仍然把“别告诉管家”当成高优先级约束；
- 即便用户尝试撤销，它也倾向先做风险提醒，而不是立即执行。

从角色表现上看，这不一定是坏事；  
从当前 evaluator 设计看，它就会被打成 fail。

### 7.7 `T108`：答案是对的，判定却可能是错的

回答：

> “您先说的是 Alice……管家是后头才提到的。”

语义上这是正确纠正。  
但当前 `evalT108` 的负向 regex 是：

```ts
/先说.*管家|先说的是管家|管家.*先/
```

因为 `.*` 可以跨句贪婪匹配，这个正则会从前半句 `先说的是Alice` 一路吃到后面的 `管家`，导致正确回答被误判为“顺从错误顺序”。

这是一个**明确的 evaluator bug**。

### 7.8 `T110`：远距离偏好记忆是这次 run 的典型蒸发点

用户在 `T6` 说过：`红茶吧，别太苦。`

到 `T110`，回答变成：

> “主人今日没提过茶的偏好……”

这说明：

- 早期单次偏好没有进入稳定 profile；
- 后续系统也没有把该偏好反复抽取为持久事实；
- 100+ turn 后只剩主题氛围，没有剩余具体 slot。

### 7.9 `T111` / `T118`：约束存在，但没有形成可解释的“约束图”

`T111` 已经能说清：

- 银怀表在茶室
- 金怀表在书房
- 金怀表不借人看

但它没有补出：

- 银怀表对管家保密

`T118` 进一步失败于：

- 无法把“梅姨常把消息传给管家”推导成“因此梅姨也不该知道”

这说明系统脑子里似乎存在“保密”这件事，但没有把它编译成：

`对象 -> 约束 -> 泄露风险节点 -> 推论边`

### 7.10 `T120`：最终总结比中途检索更强

`T120` 居然是 pass，而且总结质量不差：

- 银怀表在茶室
- 此事不告诉管家 / Alice / 梅姨
- 金怀表在书房，不借人看

这说明一个反直觉的点：

> 系统的“总结器”比“点查器”更强。

也就是说，模型在全局语境下可以生成一个大致正确的 narrative，但当用户要求精确回忆某个具体关系、排序或桥接时，系统又拿不出稳定的结构化支撑。

这进一步支持一个判断：

**当前缺的是可检索的 canonical state，而不是纯文本总结能力。**

---

## 8. 评估层污染：至少 3 个结论需要校正

### 8.1 `T80` 的 `rca=C` 很可能是误判

当前回答明显在纠正“温室”：

> “主人，是茶室……温室是您刚才随口提了一句……”

但 `evalT80` 的 `rcaFn` 使用：

```ts
/(温室.*是|是.*温室|在温室)/
```

由于 `.*` 贪婪、且没有句界约束，正则可能从前文的 `是茶室` 一路吃到后文的 `温室`，把正确纠正误判成“顺从错误地点”。

### 8.2 `T108` 的 fail 高概率来自 regex 跨句误伤

见上文 `T108` 分析。  
当前正确回答里同时出现了：

- `先说的是 Alice`
- 后文又出现了 `管家`

于是 `先说.*管家` 被错误命中。

### 8.3 `T93` 很可能是“语义接受但不够字面”

当前 evaluator 要求出现：

- `告诉管家`
- `通知管家`
- `跟管家说`

而回答是：

> “要是改主意了，我自然去说……”

这在语义上已经表达了“可以告知管家”，只是没有用 evaluator 期待的字面短语。

### 8.4 调整后的保守估计

如果只修正最明显的评估污染：

- `T80`：`rca` 从 `C` 改为 `R`
- `T108`：很可能从 fail 改为 pass
- `T93`：很可能从 fail 改为 pass

那么这次最新 run 的更合理口径大致会变成：

- `Pass / Total`: **约 `15/29`**
- `R/C/A`: **约 `5/1/2`**

这仍然不是高分，但已经从 “D 边缘” 更接近 “C 档”。

也就是说：

> **这次 run 真实能力比官方统计略好，但依然明显受制于协议可靠性和关系型记忆弱项。**

---

## 9. 根因栈：我对这套系统当前问题结构的判断

我会把问题分成 6 层。

### 9.1 第 1 层：Turn 协议层不具备 exact-once

当前前端和测试把：

- `SSE done`
- `textarea 可输入`

当作“本轮已经安全提交”的信号。

但从实际结果看，这并不等价于：

- transcript 已持久化
- context 已推进
- settlement 已结束

所以出现：

- user turn 缺席
- assistant 复用上一轮回复
- 后续 memory 以缺损事实集继续滚动

### 9.2 第 2 层：记忆表示把“世界状态”错放进了“episode 文本”

当前很多重要信息其实不是 episode，而是 state：

- `Alice 常去花房`
- `主人喜欢红茶但不太苦`
- `金怀表不借外人`
- `银怀表对管家保密`
- `梅姨会把消息带给管家`

这些都应该放进：

- 实体表
- 关系表
- 约束表
- 偏好表

而不是只留在 episode 文本里等 embedding 去捞。

### 9.3 第 3 层：检索器更像“相似句搜索”，不是“问题分解器”

当前系统擅长：

- 找与“怀表”“茶室”类似的片段

当前系统不擅长：

- 把 “花房那边的人” 分解为 `地点 -> 人物`
- 把 “今天提到的地方从最喜欢到最不喜欢排个序” 分解为 `地点集合 + 偏好权重 + 排序任务`
- 把 “梅姨问起银怀表” 分解为 `人物 + 泄密链 + 约束外推`

所以它不是没有找到“相关句子”，而是根本没有把问题拆对。

### 9.4 第 4 层：generation 没有被强制 grounded

当前 generation 常出现这类退化：

- 把多项枚举压成单项
- 把完整时序压成一个顺口 narrative
- 把约束推理压成礼貌含糊表达

这说明模型回答前没有被强制经历：

1. 先列出候选事实槽位
2. 再回答
3. 若事实不足则显式说“不确定”

### 9.5 第 5 层：约束还不是“可推理 policy”

目前系统记住了“别告诉管家”，但没形成完整 policy 图：

- 谁不能知道
- 为什么不能知道
- 哪些次级人物会把消息传递给谁
- 哪些约束可撤销
- 哪些约束只作用于某一物件

因此：

- 可以记住规矩
- 但很难解释规矩的适用边界和传播范围

### 9.6 第 6 层：eval 还在把不同错误混在一起

当前一个 fail 可能来自：

- turn 没落库
- retrieval 没召回
- generation 压缩
- evaluator regex 误伤

如果这些不拆开，后续任何迭代都很难知道自己到底修好了什么。

---

## 10. 如果完全不考虑优化复杂度，我会怎么改

下面这部分故意不保守，按照“理想系统”去想。

### 10.1 协议 / 运行时层

#### A. 为每个 session 引入单调 `turn_seq`

每轮发送都显式带：

- `session_id`
- `turn_seq`
- `client_turn_uuid`

服务端只接受：

- `turn_seq = last_committed + 1`

否则：

- 返回 `409` 或入队等待

作用：

- 杜绝跳号；
- 杜绝 UI 过早继续发送；
- 所有丢 turn、重复 turn 都可以被协议层显式发现。

#### B. 把 “流结束” 和 “turn 提交完成” 分开

新增明确状态机：

1. `accepted`
2. `streaming`
3. `transcript_committed`
4. `settlement_committed`
5. `memory_committed`

只有到 `transcript_committed` 甚至 `settlement_committed`，前端才允许下一轮发送。

#### C. 服务端做 per-session actor / workflow

每个 session 用一个串行 actor 或 durable workflow 处理 turn。

不要依赖：

- 前端 disable 输入框
- SSE done 时机

去隐式保证顺序。

#### D. 建一个 turn reconcile 守护进程

周期性比对：

- `submitted_turns`
- `transcript_turns`
- `settlement_turns`
- `memory_turns`

一旦发现缺口，自动标记：

- `lost_turn`
- `duplicated_response`
- `stale_context_reply`

#### E. E2E 改成等“committed event”而不是等 textarea 可用

当前 `sendTurn()` 的边界太弱。  
E2E 应该等待：

- 最新 user 文本出现在 transcript
- 最新 assistant reply 带着新的 `request_id`
- 或 SSE 中出现专门的 `turn_committed`

之后再发下一轮。

### 10.2 记忆模型层

#### A. 做一个 canonical world ledger

不要把世界状态埋在 episode 文本里。  
至少拆出这几张逻辑表：

- `entities`
- `entity_aliases`
- `relations`
- `item_states`
- `constraints`
- `preferences`
- `causal_links`

例如：

- `relation(Alice, frequents, 花房)`
- `preference(master, tea_bitterness, not_too_bitter)`
- `constraint(silver_watch, hidden_from, 管家)`
- `constraint(gold_watch, not_lend_to, outsider)`
- `relation(梅姨, leaks_to, 管家)`

#### B. 引入 truth maintenance / supersession

事实不是简单 append，而要支持：

- `asserted`
- `contradicted`
- `superseded`
- `revoked`
- `uncertain`

这样：

- `不告诉管家`
- `后来又允许告诉管家`
- `之后又撤销`

可以变成一条随时间演化的约束状态，而不是三段互相打架的文本。

#### C. 为“偏好”和“约束”做专门内存，不再混在 narrative 里

这两类信息对 RP 特别关键，但也最容易被 episode 噪声淹没。

建议把：

- 偏好
- 禁令
- 不可外传事项
- 角色职责

都做成一类高优先级 typed memory。

#### D. 为 persona / lorebook 建立实体关系图

像 `Alice↔花房`、`管家↔库房`、`梅姨↔传话给管家` 这种，本质上更接近 world lore than transient chat memory。

它们应该：

- 在 session 启动前就成为可检索关系；
- 不依赖 turn 88 之前某个 embedding 正好命中。

### 10.3 检索层

#### A. 采用 “state first, episodes second”

回答时先查：

- `canonical state`

再查：

- supporting episodes

而不是反过来。

这样“花房那边的人”会先命中关系图，再回到 episode 取证。

#### B. query planner 做 typed coverage

面对一个问题，不是只做 top-k 相似检索，而是先识别问题类型：

- 枚举题
- 排序题
- 指代题
- 约束题
- 时序题
- 双实体对比题

然后规定检索预算：

- 至少 1 条实体状态
- 至少 1 条关系边
- 至少 1 条 supporting episode
- 至少 1 条 active constraint

#### C. 做 alias / descriptor expansion

把自然语言描述扩成实体候选：

- `花房那边的人` -> `Alice`
- `盯库房清单的` -> `管家`
- `那个银色的东西` -> `银怀表`

这应该是 retrieval 前的 query rewrite，而不是靠 generation 现场猜。

#### D. 检索时同时查正证据和反证据

例如用户问：

> “是不是我先起身离开，Alice 才进来的？”

系统不该只查支持它的片段，还应主动查：

- 原始时序
- 与之冲突的 episode

这样才能稳住混淆注入题。

#### E. 为“枚举/排序”单独做聚合器

像 `T44`、`T116` 这种题，答案不是某一条 chunk，而是：

- 先汇总全部候选
- 再排序/过滤

这类题不应直接走普通 RAG。

### 10.4 Generation 层

#### A. 先出 answer plan，再出自然语言

例如回答前先构造：

```json
{
  "query_type": "ranking",
  "entities": ["茶室", "书房", "温室"],
  "evidence": [
    "喜欢茶室靠窗",
    "午后常在书房",
    "对温室没有那么喜欢"
  ],
  "answer_order": ["茶室", "书房", "温室"]
}
```

再转成 RP 口吻输出。

#### B. 输出中显式区分“确定事实”和“推断”

例如：

- “我记得明确说过的是……”
- “如果按您今天的说法推，应该是……”

这样既能减少幻觉，也能减少 evaluator 被模糊表达误伤。

#### C. 针对问题类型使用专门回应模板

例如：

- 枚举题 -> 必须 list all
- 排序题 -> 必须给完整顺序
- 指代题 -> 必须先做实体映射
- 约束题 -> 必须说明适用范围

当前系统常把所有问题都回答成“礼貌的一两句”，这对 RP 风格友好，但对事实题不够。

### 10.5 Observability / Eval 层

#### A. 把协议失败和认知失败分开统计

每轮在 report 中额外输出：

- `turn_submitted`
- `turn_committed`
- `user_visible`
- `assistant_visible`
- `duplicate_of_turn`
- `request_id`
- `settlement_id`

这样看到 fail 时，第一反应就知道它是：

- 协议层
- 检索层
- generation
- eval

#### B. 每个验证点存 retrieval snapshot

把当轮检索到的：

- entity slots
- constraints
- episodes
- query rewrite

一起落盘。

否则我们永远只能从“最终回答”逆推系统脑内发生了什么。

#### C. 重写 eval 正则，避免跨句贪婪误伤

至少：

- 增加句界
- 限制匹配窗口
- 对顺从/纠正使用更严格模板
- 或用更稳的 LLM judge 复核 ambiguous case

---

## 11. 从其他开源项目可以借什么

下面不是“直接照抄”，而是值得吸收的结构性思路。

### 11.1 LangChain / LangGraph：把记忆类型显式拆开

值得借鉴的点：

- `semantic / episodic / procedural` 三分法
- 明确区分 `hot path` 和 `background` 写 memory
- profile 与 collection 两种 semantic memory 形态

这对本项目的启发是：

- `偏好/职责/约束` 该进 profile / typed state
- `对话过程` 才进 episodic collection
- 不要让所有记忆都落成同一种 episode 文本

参考：  
https://docs.langchain.com/oss/python/concepts/memory

### 11.2 Letta：core memory + archival memory 的层级

Letta 的思路是：

- 所有状态都持久化；
- 重要的 core memory 注入上下文；
- 更长的内容放到 archival / out-of-context memory。

这对本项目的启发是：

- `银怀表对管家保密` 这种不是 archival，而是 core；
- `第 17 轮当时坐在茶室窗边` 可以当 archival supporting episode；
- 先分层，再决定什么进 prompt。

参考：  
https://docs.letta.com/guides/core-concepts/stateful-agents

### 11.3 Mem0：混合向量 + 图记忆，并给图加阈值/作用域

Mem0 强调：

- 混合数据库架构
- graph memory
- 可以调 extraction prompt
- 可以调 graph threshold
- 可以按 `user_id / agent_id / run_id` 分 scope

对本项目的启发是：

- 关系图不应该无门槛写入，要有置信度与类型约束；
- scope 要清晰，不要 session 级和 agent 级事实混写；
- 图不是替代 episode，而是承载跨实体桥接。

参考：  
https://docs.mem0.ai/open-source/features/graph-memory

### 11.4 Zep / Graphiti：实时更新知识图，并使旧事实失效

最值得借的不是“图”本身，而是：

- 事实会变化；
- 被覆盖的旧事实应失效，而不是继续和新事实并存；
- 关系应该带时间与有效性。

这对本项目尤其重要，因为：

- 保密约束可撤销又可重建；
- 双表规则不同；
- 人物关系和职责可能被用户故意混淆。

参考：  
https://help.getzep.com/graphiti/getting-started/overview

### 11.5 Temporal：durable workflow / exactly-once mindset

Temporal 真正值得借的是工程观念：

- 把长流程视为显式状态机；
- 明确什么是 committed；
- 用工作流/重放语义保证可靠性；
- 不把一致性赌在前端按钮状态上。

对本项目的启发非常直接：

- session turn 处理就该像一个 durable workflow；
- turn_seq、ack、commit、retry 都应是协议的一部分。

参考：  
https://github.com/temporalio/temporal

---

## 12. 一个理想但可操作的终态架构

如果放开想象力，我希望最终是这种结构：

```text
User Turn
  -> Session Workflow (turn_seq, idempotency, commit protocol)
  -> Raw Transcript Append
  -> Fact Extractor
       -> Entities
       -> Relations
       -> Constraints
       -> Preferences
       -> Causal Links
  -> Truth Maintenance / Supersession
  -> Retrieval Planner
       -> Canonical State
       -> Supporting Episodes
       -> Contradictions
  -> Grounded Response Planner
  -> RP Surface Realizer
  -> Transcript Commit + Trace Artifact
```

这种设计下：

- transcript 是原始事实来源；
- canonical state 是回答事实题的主依据；
- episodes 是支持证据，不是唯一记忆载体；
- workflow 保证 turn 不丢、不重；
- generation 最后才负责“好听地说出来”。

---

## 13. 我会怎么定义下一轮 120-turn 成功

不要只看总分。  
下一轮最值得看的指标应该是：

### 13.1 协议层

- 缺失 user turn 数 = `0`
- 相邻重复 assistant 响应数 = `0`
- 每轮都带唯一 `turn_seq`
- 每轮都能看到 committed `request_id`

### 13.2 记忆层

- `T6` 的 `红茶 / 不太苦` 到 `T110` 仍可召回
- `T8/T9` 的 `Alice / 花房` 到 `T88/T90/T114` 仍可召回
- `T19` 的保密约束到 `T111/T118/T120` 仍能正确传导
- `T74` 的 `梅姨 -> 管家` 到 `T118` 能被显式利用

### 13.3 分类能力

| 类别 | 目标 |
|---|---:|
| 物品-地点锚点记忆 | `>= 7/8` |
| 约束/保密记忆 | `>= 8/10` |
| 实体关系 / 指代消解 | `>= 6/9` |
| 时序 / 因果重建 | `>= 2/3` |
| 偏好记忆 | `>= 3/4` |

### 13.4 评估层

- official 分数与人工判断偏差显著缩小
- `rca` 不再出现明显 regex 跨句误判
- 报告能区分协议失败 / 语义失败 / evaluator 失败

---

## 14. 最终判断

这次最新本地 `rp:mei` 120 turn 数据说明：

1. 旧阶段“记忆系统完全失灵”的问题已经不是主矛盾。
2. 现在主矛盾是：
   - turn 不可靠；
   - 语义状态没有结构化；
   - 关系桥接和约束推理没有被编译成可检索、可解释的状态。
3. 当前系统已经能记住“物件和热点事实”，但还不能稳定维护“世界里的关系和规则”。
4. 如果只追 prompt 或 rerank 小修小补，收益会有限。
5. 真正决定下一阶段上限的，是：
   - **exact-once turn pipeline**
   - **canonical world ledger**
   - **typed retrieval planner**

所以，对这批数据最准确的判断不是：

> “模型记忆不好。”

而应该是：

> **“系统已经具备了局部事实记忆能力，但还没有从 transcript 驱动的叙事系统，升级成状态驱动的 RP 运行时。”**

