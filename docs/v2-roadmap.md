# Maids-Dashboard v2+ 需求与路线图

> 本文档承接 `refactor-consensus.md`，记录 v1 切换完成之后仍需继续完善的需求。
> v1 的目标是"最短路径让驾驶舱可用"；本文档列出**为了让驾驶舱真正称职**和
> **为未来新能力铺路**所需的后续工作。

## 阅读指南

- **P0** — 关键缺失：v1 切换后 1-3 个月内应补齐，否则驾驶舱体验有硬伤
- **P1** — 重要增强：3-6 个月内期望达成
- **P2** — 锦上添花：6 个月以上，有余力时做
- **L** — 长期愿景：架构级演进，需要 MaidsClaw 同步升级

每个条目格式：
```
### 编号 — 标题
- 描述：
- 动机 / v1 未做原因：
- 前置依赖：
- 涉及 (MaidsClaw / Dashboard / Infra)：
```

---

## P0：关键缺失能力

### P0-1 — MaidsClaw Metrics Pipeline
- **描述**：在 MaidsClaw 内建立 metrics 采集层，收集 token 用量、
  latency 分布、model 调用成功率、retrieval hit rate、drift 分数、
  memory settlement throughput 等核心指标；通过 gateway 新增
  `/v1/metrics/*` 路由暴露给 Dashboard。
- **动机**：v1 Observatory 的"Weekly Snapshot"只能从现有 request/session
  数据客户端聚合，维度受限，无法回答"最近 Alice 的 RP 质量是不是在退化"
  "模型 A 比模型 B 成功率高多少"这类关键问题。
- **前置依赖**：MaidsClaw 团队需要先决定 metrics 采集框架
  （OpenTelemetry / Prometheus-client / 自研内存聚合器），然后决定持久化
  策略（时序库 / PG 聚合表 / 内存滚动窗口）。
- **涉及**：MaidsClaw（大规模新增）+ Dashboard（Observatory 接入新路由）

### P0-2 — Study Room 的 Memory 写能力
- **描述**：开放 Core Memory Blocks 的 append / replace 编辑，配合审计日志
  和 diff 预览；支持手动编辑 persona block / user block 等核心记忆块。
- **动机**：驾驶舱定位下，你应该能手工调整 agent 的核心记忆
  （例如修正 Alice 对"用户是 TeaCat"的记忆），v1 只读让 Study 的价值减半。
- **前置依赖**：
  - MaidsClaw 新增 `POST /v1/agents/{id}/memory/core-blocks/{label}:append`
    和 `PUT ... :replace` 路由
  - 写操作必须进入审计日志（`data/audit/gateway.jsonl`）
  - Dashboard 侧 Study Room 增加编辑 UI、diff 预览、二次确认
- **涉及**：MaidsClaw + Dashboard

### P0-3 — Jobs Cancel / Retry / Requeue
- **描述**：开放 `/v1/jobs/{id}:cancel`、`:retry`、`:requeue` 写接口；
  Dashboard 的 Garden Jobs 面板和 War Room Failed Requests 面板提供对应
  操作入口。
- **动机**：v1 Jobs 只能看不能管，发生问题时你只能去服务器 `bun run cli` 手工
  处理——这和"驾驶舱"承诺背离。
- **前置依赖**：
  - `src/jobs/pg-runner.ts` 暴露 cancel / retry 的 public API
  - 需要定义 job 状态转移图（pending → running → {succeeded, failed,
    cancelled, retrying}），保证并发安全
  - 需要写审计日志
- **涉及**：MaidsClaw + Dashboard

### P0-4 — Kitchen 的 Task Agent 提交入口
- **描述**：落地 Kitchen 的正式形态——复用 `src/memory/task-agent.ts` 或
  `task:runner` ephemeral agent 设计，前端做一个"提交一次性任务"的表单
  （任务描述、输入数据、输出 schema 选项），MaidsClaw 执行完把结果写回
  可见历史。
- **动机**：Kitchen v1 是 placeholder，副交互能力缺失；所有非对话类的请求
  都不得不硬塞进 Grand Hall 的 chat 流。
- **前置依赖**：
  - MaidsClaw 新增 `POST /v1/tasks`（创建）、`GET /v1/tasks` / `GET /v1/tasks/{id}`
    （查询）路由
  - Task agent 的结果存储机制（可能复用 `data/` 下的某个文件 / PG 表）
  - Dashboard 侧 Kitchen Room 全量实现表单 + 历史列表 + 结果查看
- **涉及**：MaidsClaw（中等扩展）+ Dashboard

### P0-5 — 认证落地 (Tunnel + Access + Token Login Screen)
- **描述**：v1 文档里只定了三层信任模型，具体的隧道和 SSO 还没部署。P0
  时期必须完成：
  - 选定隧道（推荐 Cloudflare Tunnel）并配置到位
  - 配置 Cloudflare Access policy（email allowlist 或 SSO）
  - Dashboard 侧实现 login screen + token 存储 + 401 重登流程
  - MaidsClaw gateway 的 bearer token 热加载机制
- **动机**：v1 切换后 Dashboard 第一次真正对外暴露，认证是硬门槛；
  没有它任何人拿到隧道域名就能进入驾驶舱。
- **前置依赖**：无
- **涉及**：Infra + MaidsClaw + Dashboard

### P0-6 — Audit Log 的 Dashboard 查看入口
- **描述**：MaidsClaw 侧已经在 v1 写入 `data/audit/gateway.jsonl`；P0 期
  在 gateway 新增 `GET /v1/audit` 只读路由，Dashboard 在 War Room 或 Garden
  里加一个"最近操作"视图，可按时间 / 操作类型 / 目标对象过滤。
- **动机**：写操作审计若不可见，审计日志就是"存档不用的保险柜"——
  无法快速回溯"上周我是不是删了某个 persona"。
- **前置依赖**：v1 的 audit log 基础设施（已在 §5.3.7 规划）
- **涉及**：MaidsClaw + Dashboard

---

## P1：重要增强

### P1-1 — Agents / Providers / Runtime 配置的写能力
- **描述**：开放 `agents.json`、`providers.json`、`runtime.json` 的编辑接口；
  Garden Room 提供结构化表单编辑。
- **动机**：v1 这些是只读的，改动要手工编辑配置文件重启 MaidsClaw；P1 期
  应让你在 Dashboard 里切换 provider、调整 talker/thinker 参数、启停
  agent preset。
- **前置依赖**：
  - Providers 的 secret 字段需要单独的安全写入通道（secret 不在 gateway
    response 里回传，只接受 write 时的新值，不展示历史）
  - Runtime 修改可能需要 hot reload；某些字段（如嵌入模型 ID）可能要求
    重启
  - agents.json 修改要重建 agent registry
- **涉及**：MaidsClaw + Dashboard

### P1-2 — Real Metrics Dashboard（Observatory 二阶段）
- **描述**：基于 P0-1 的 metrics pipeline，重写 Observatory：
  - 延迟 / token 用量 / 错误率的时间序列图
  - 按 persona / agent / model / provider 的分组对比
  - 异常检测提示（某指标偏离基线 > N σ 时高亮）
- **前置依赖**：P0-1 必须先完成
- **涉及**：Dashboard 为主（假设 P0-1 已准备好数据面）

### P1-3 — Session Fork / Checkpoint 能力
- **描述**：允许在 Grand Hall 的 session 浏览视图里"基于某 turn 分叉"，
  生成一个新 session 继承前 N 个 turn 的历史；或给 session 打 checkpoint
  标记便于回滚。
- **动机**：RP 场景经常需要"这里往回退几步换个走向"；v1 必须手工新建
  session + 复制粘贴 transcript，非常痛苦。
- **前置依赖**：
  - MaidsClaw 需要决定 session fork 的语义（新 session 复用原 interaction
    log 的前缀？独立拷贝？memory state 如何继承？）
  - 这是一个 MaidsClaw 的架构级新能力，不是纯 UI
- **涉及**：MaidsClaw（设计 + 实现）+ Dashboard

### P1-4 — Retrieval Trace 联动
- **描述**：Observatory / War Room 的 request 详情里，点击"检索了什么记忆"
  可直接跳转到 Study Room 对应 agent 的 Retrieval Trace tab，并 scroll 到
  该次 retrieval 的详情。
- **动机**：v1 各 Room 是孤岛；诊断"为什么 Alice 忘了一件事"需要在
  Observatory 查 request → 记下 retrieval hit → 切到 Study → 手动定位——
  体验破碎。
- **前置依赖**：URL-based 跨 Room 跳转（已在 v1 SPA 路由规划中，P1 只是
  接线）
- **涉及**：Dashboard 为主

### P1-5 — Persona / Lore 的草稿与版本历史
- **描述**：Library Room 支持：
  - 自动保存草稿（已在 Q8 D 类规划）
  - 查看历史版本（利用 v1 已有的 `.backup/` 机制）
  - 从历史版本恢复
  - 导出 / 导入 JSON（方便在多机器之间搬运）
- **前置依赖**：v1 的原子写回 + `.backup` 机制已存在
- **涉及**：Dashboard + 少量 MaidsClaw gateway 扩展（历史版本读取路由）

### P1-6 — 全文搜索
- **描述**：顶层搜索框，可跨 Room 搜索：
  - Session 内容（transcript 全文）
  - Memory 内容（core blocks / episodes / narratives）
  - Persona / Lore 字段
  - Log 内容
- **前置依赖**：
  - MaidsClaw 需要提供跨领域搜索端点（可能复用 memory 已有的 embedding
    / keyword 搜索基础设施）
  - Dashboard 侧需要搜索结果的统一展示格式
- **涉及**：MaidsClaw + Dashboard

### P1-7 — 事件总线 / 按需 SSE 推送
- **描述**：替换部分轮询为推送。**不**做全域 firehose，而是按领域逐一
  升级：
  - `/v1/sessions:watch` — Grand Hall 的 session 列表实时更新
  - `/v1/jobs:watch` — Garden 的 Jobs 队列实时更新
  - `/v1/logs:tail` — War Room Logs 实时 tail
- **动机**：v1 的 2 秒轮询对单用户足够，但 Grand Hall 在"正在等别人回复"
  的场景下会有视觉延迟；按需 SSE 让最关键的实时场景更顺滑。
- **前置依赖**：MaidsClaw 需要在对应子系统加一个**轻量**的 change-notify
  机制（不需要完整事件总线）
- **涉及**：MaidsClaw + Dashboard

---

## P2：锦上添花

### P2-1 — 国际化 (zh/en)
- **描述**：引入 `i18next` 或 `react-intl`，把 UI 字符串集中到
  `src/locales/{en,zh}.json`。
- **动机**：v1 英文界面足够单人使用；若日后你希望中文展示或向中文社区
  分享，需要 i18n 层。
- **涉及**：Dashboard 为主

### P2-2 — 多主题 / 自定义皮肤
- **描述**：除了现有 dark / light 主题，允许用户自定义宅邸氛围
  （例如"维多利亚"、"现代极简"、"赛博女仆"等配色包）。
- **涉及**：Dashboard 为主

### P2-3 — 本地离线缓存持久化
- **描述**：React Query 的 `persistQueryClient` 接入，让页面刷新后仍能
  快速展示最后状态；敏感数据需加密 + TTL。
- **前置依赖**：Q8 明确 v1 "敏感数据零持久化"，P2 期需重新设计哪些数据
  可以 persist、加密方案、TTL 策略
- **涉及**：Dashboard 为主

### P2-4 — 正式 a11y audit
- **描述**：跑一次完整的可访问性审计（`@axe-core/react` + 屏幕阅读器
  手测），补全缺失的 aria 标签、焦点管理、键盘快捷键。
- **涉及**：Dashboard 为主

### P2-5 — 性能 budgets + Lighthouse CI
- **描述**：在 CI 加入 Lighthouse 检查，设定 bundle 大小上限、首次加载
  时间上限；性能退步时阻塞 PR。
- **涉及**：Infra + Dashboard

### P2-6 — E2E 测试 (Playwright)
- **描述**：补一条或几条关键路径的 E2E 测试。需要一个能在 CI 里启动的
  MaidsClaw harness（mock 或真实 + 测试数据库）。
- **前置依赖**：MaidsClaw 侧提供可复现的测试启动模式
- **涉及**：Dashboard + MaidsClaw

### P2-7 — Dashboard 错误监控接入
- **描述**：接入 Sentry 或自托管的错误收集，捕获前端异常、API 错误、
  SSE 断连原因等。
- **动机**：当驾驶舱被你以外的人使用（P2 或 L 阶段的"对外分发"场景）
  后，console log 不再够用
- **涉及**：Dashboard + Infra

### P2-8 — 快捷键系统
- **描述**：类似 Linear / Raycast 的快捷键驱动操作：
  - `Cmd+K` 全局搜索（P1-6 的入口）
  - `g + h` 跳转 Grand Hall
  - `g + l` 跳转 Library
  - `n` 新建 session
  - `/` 聚焦当前 Room 的搜索框
- **涉及**：Dashboard 为主

### P2-9 — Blackboard 与 State 的写能力（谨慎开放）
- **描述**：极少数场景需要人工修改 blackboard（调试时）。需要严格的
  审计 + 警告 + undo 机制。
- **动机**：v1 明确说"写 blackboard 会脏掉 session"，P2 期如确有需求，
  可以谨慎开放
- **涉及**：MaidsClaw + Dashboard

---

## L：长期愿景

### L-1 — Ballroom 正式启用 (Multi-RP Agent 并发)
- **描述**：MaidsClaw 架构扩展支持多 RP agent 在同一 session 并发对话、
  场景编排、剧情状态机；Ballroom Room 全量实现。
- **核心挑战**：
  - Session 的多 agent 模型（每个 agent 独立 context？共享 blackboard？
    turn 顺序如何调度？）
  - Memory 的跨 agent 可见性（Alice 听到 Bob 说的话，如何写进谁的记忆？）
  - Prompt 上下文的复合构造（多 agent 视角切换）
  - 前端的多人聊天 UI
- **涉及**：MaidsClaw（架构级）+ Dashboard（全量实现）

### L-2 — 剧情状态机 / 场景管理
- **描述**：配合 L-1，提供"场景"概念：物理位置 / 时间 / 参与者的可编辑
  状态，agent 在对话时感知到场景变化。
- **依赖**：L-1 和 MaidsClaw 的 area state 机制深化
- **涉及**：MaidsClaw + Dashboard

### L-3 — 驾驶舱对外分发
- **描述**：把 Dashboard 变成可以给其他 MaidsClaw 用户使用的产品：
  - 多用户账户体系
  - 细粒度权限（谁能看谁的 session / 改谁的 persona）
  - 订阅 / 付费模型（如适用）
  - 用户引导与 onboarding
  - 文档网站
- **动机**：v1 明确"非目标"之一是对外分发；若将来社区有需求，这是一个
  独立产品化阶段
- **涉及**：MaidsClaw + Dashboard + Infra + Legal

### L-4 — 移动端体验优化
- **描述**：Dashboard 响应式布局基本可用在手机，但要真正好用需要：
  - Room 导航改为底部 tab / 抽屉
  - Chat 输入优化（语音？快捷回复？）
  - 消耗电量的轮询策略（手机上更保守）
- **涉及**：Dashboard 为主

### L-5 — Plugin / Extension 系统
- **描述**：允许第三方或你自己开发 Dashboard 扩展：
  - 自定义 Room
  - 自定义 chart widget
  - 自定义 MaidsClaw gateway 调用封装
- **动机**：驾驶舱视角下，每个人的日常关注点不同；插件系统让个性化
  成为可能
- **依赖**：首先需要稳定的 Dashboard 组件 API 和类型契约
- **涉及**：Dashboard（架构级）

---

## 非功能性需求 (贯穿所有阶段)

### NFR-1 — 契约稳定性
- **目标**：Dashboard 升级一次，不能因为 MaidsClaw gateway 某个字段改名
  而大面积崩溃
- **手段**：
  - `.maidsclaw-version` 文件锁定 + 显式 bump（v1 已落地）
  - MaidsClaw gateway 路由遵守 semver 式版本演进（`/v1/*` 冻结后仅加
    新字段，不删不改）
  - 破坏性改动走 `/v2/*` 路径并保留 `/v1/*` 至少 N 个版本
- **时机**：从 v1 切换当天开始执行

### NFR-2 — 可观测性
- **目标**：MaidsClaw 和 Dashboard 出问题时能快速定位
- **手段**：
  - MaidsClaw：结构化日志 + request id 贯穿调用链 + audit log（v1 已规划）
  - Dashboard：顶层 ErrorBoundary + API 错误上报（v1 已规划）
  - P2-7 外部监控接入
- **时机**：持续

### NFR-3 — 数据备份
- **目标**：`config/*.json`、`data/*.db`、MaidsClaw PG 的定期备份
- **手段**：
  - `.backup/` 目录每次 write 留一份（v1 已规划）
  - P0 期补充：服务器层面的定时快照 + 异地备份
  - P1 期：Dashboard 提供"导出所有 persona / lore"功能
- **时机**：P0

### NFR-4 — 安全审计
- **目标**：定期检查依赖漏洞、XSS / CSRF 风险、gateway 授权绕过
- **手段**：
  - `bun audit` 在 CI 中运行
  - 每季度手工 review 一次 write 路由的授权检查
  - P2 期接入专门的 SAST 工具
- **时机**：P0 开始

### NFR-5 — 文档完整性
- **目标**：README / RUNBOOK / 本文档 / refactor-consensus.md 保持与代码
  同步
- **手段**：
  - 每个 P0 / P1 任务完成时更新对应章节
  - 重大架构变更走一次"更新共识文档"的 PR
  - 避免"注释在代码里，真相在 Slack / 口头传达里"
- **时机**：持续

---

## 里程碑建议

按时间推进的粗线条：

**T+0（v1 切换当天）**
- §9 并行分支硬切完成
- Welcome / Grand Hall / Library 可用
- 其他 Room 至少 placeholder 不崩

**T+2 周**
- Study / War Room / Garden / Observatory 基本可用
- Kitchen / Ballroom 保留 placeholder

**T+1 月**
- P0-5 认证落地
- P0-6 audit log 查看入口

**T+3 月**
- P0-1 Metrics pipeline 初步可用
- P0-2 Study memory 写能力
- P0-3 Jobs cancel / retry
- P0-4 Kitchen task agent 入口

**T+6 月**
- P1-1 配置写能力
- P1-2 真正的 Observatory
- P1-3 Session fork
- P1-4 Retrieval trace 联动
- P1-5 Persona / Lore 历史版本
- P1-6 全文搜索
- P1-7 按需 SSE 推送

**T+12 月 及以后**
- P2 系列按优先级滚动推进
- L 系列需 MaidsClaw 架构级准备，按 MaidsClaw 路线图协同

---

## 变更记录

- 初稿：与 `refactor-consensus.md` 同时创建，覆盖 v1 之后全部已识别的
  增量需求
