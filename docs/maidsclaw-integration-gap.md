# Maids Dashboard 接入 MaidsClaw Gap 分析

更新时间: 2026-04-10

## 1. 结论

当前 `Maids-Dashboard` 不能直接把后端从 OpenClaw 切到 `D:\Projects\MaidsClaw` 就算“正式接入”。

核心原因不是单一接口差异，而是三层同时不兼容:

- 当前 Dashboard 的后端实现是 `OpenClaw` 专用适配层，强依赖 `OPENCLAW_ROOT`、`openclaw.json`、OpenClaw gateway、`canon.db`、`cron/jobs.json`、`events.jsonl` 等文件和约定。
- `MaidsClaw` 现在提供的是另一套运行时合约: `session / turn / inspect / health`，底层存储是 PostgreSQL，配置模型是 `agents.json / personas.json / lore.json / auth.json / runtime.json`。
- 当前前端页面中有相当一部分不是“通用观察面板”，而是 OpenClaw/Canon/RP 辅助系统的专属页面，MaidsClaw 里没有等价 HTTP 能力。

结论上，这次工作应按“Dashboard 原生并入 MaidsClaw”来做，而不是给现有 Python 后端再包一层兼容 adapter。

这意味着目标态应该是:

- Dashboard 的运行时后端归属 `MaidsClaw`
- 控制面 API 归属 `MaidsClaw/Bun`
- 配置、会话、观测、维护能力归属 `MaidsClaw`
- 现有 Python/FastAPI 后端只作为迁移期资产，最终应退役

## 2. 基线判断

### 2.1 当前 Dashboard 的真实定位

当前仓库更像是:

- Python/FastAPI 写的本地控制平面
- 前端 React/Vite 只是 UI 壳
- 后端大量逻辑是“读取 OpenClaw 工作区文件 + 调 OpenClaw gateway + 维护一份自己的 SQLite 派生库”

直接证据:

- `README.md`
- `dashboard_backend.py`
- `api/app.py`
- `services/session_service.py`
- `gateway/client.py`
- `dashboard_db.py`
- `api/cron.py`
- `api/heartbeat.py`
- `api/canon.py`

### 2.2 MaidsClaw 当前暴露的真实能力

MaidsClaw 当前已经有比较完整的运行时和 inspect 能力，但 HTTP 面暴露出来的重点是:

- `GET /healthz`
- `GET /readyz`
- `POST /v1/sessions`
- `POST /v1/sessions/{session_id}/turns:stream`
- `POST /v1/sessions/{session_id}/close`
- `POST /v1/sessions/{session_id}/recover`
- `GET /v1/requests/{request_id}/summary|prompt|chunks|diagnose|trace`
- `GET /v1/sessions/{session_id}/transcript|memory`
- `GET /v1/logs`

直接证据:

- `D:\Projects\MaidsClaw\src\gateway\routes.ts`
- `D:\Projects\MaidsClaw\src\gateway\controllers.ts`
- `D:\Projects\MaidsClaw\src\app\contracts\session.ts`
- `D:\Projects\MaidsClaw\src\app\contracts\execution.ts`
- `D:\Projects\MaidsClaw\src\app\inspect\view-models.ts`

## 3. P0 Gap

以下缺口不补，不能称为“正式接入”。

| 领域 | 当前 Dashboard 假设 | MaidsClaw 现状 | 结论 |
| --- | --- | --- | --- |
| 后端绑定对象 | 绑定 OpenClaw root、本地文件树和 OpenClaw gateway | 绑定 MaidsClaw gateway + PG + 自身 config/data 目录 | 需要新接入层，不能直接替换 base URL |
| Agent/Session 列表 | 前端依赖 `/api/v1/maids`、`/api/v1/sessions` | MaidsClaw 网关没有同等 list route | 需要新增 HTTP facade 或改前端页面语义 |
| 全局 SSE | 当前前端依赖 `GET /api/v1/stream` 的 EventSource 全局广播 | MaidsClaw 是每次 turn 的 `POST .../turns:stream` 流 | 需要重做实时模型，不能直接复用 |
| 安全模型 | Dashboard 写操作依赖 loopback + Origin 校验 + `X-Confirm-Secret` | MaidsClaw 当前 gateway 没有同等级 HTTP 保护层 | 需要定义新的本地控制面安全边界 |
| 运维依赖 | 当前项目主要是 Python + SQLite + OpenClaw 工作区 | MaidsClaw 需要 Bun + PostgreSQL，且内存写入路径已转 PG | 部署与启动链路要重做 |

### 3.1 平台归属缺口

既然目标是“完全适配且接入 MaidsClaw”，那接入层问题就不再是“谁来写 adapter”，而是“哪些 Dashboard 能力要成为 MaidsClaw 的原生控制面能力”。

这里需要先定三条硬约束:

- 不新增长期存在的 Python `MaidsClawAdapter`
- 不把 OpenClaw 专属数据结构继续当作控制面标准
- 不维持长期双后端归属

换句话说，当前 `Maids-Dashboard` 里的后端职责要拆成两类:

- 可迁移为 MaidsClaw 原生能力的: `health / readyz / session / inspect / agent list / maintenance / config editing`
- 应删除或重定义的 OpenClaw 专属能力: `openclaw.json patch`、`canon.db` 视图、`cron/jobs.json`、`HEARTBEAT.md`、OpenClaw dispatch/incident 语义

真正的 P0 不是“写个 bridge”，而是定义一套 MaidsClaw 自己拥有的 Dashboard contract。

### 3.2 Agent / Session 管理缺口

当前 `Grand Hall` 依赖:

- `/api/v1/maids`
- `/api/v1/sessions`
- `/api/v1/sessions/{key}/messages`

但 MaidsClaw 当前公开的 HTTP 里只有:

- 创建 session
- 关闭 / 恢复 session
- 读取 transcript / memory

缺少:

- agent 列表
- session 列表
- 面向 Dashboard 的简化 transcript 列表接口

另外，当前 Dashboard 的 maid 概念来自 `openclaw.json` 里的 agent/workspace/binding/sandbox 视图；MaidsClaw 的 agent 模型则是 `role / lifecycle / userFacing / outputMode / modelId / personaId / toolPermissions`。这不是字段重命名能解决的差异。

直接证据:

- `services/maid_service.py`
- `services/session_service.py`
- `D:\Projects\MaidsClaw\config\agents.example.json`
- `D:\Projects\MaidsClaw\src\session\service.ts`

### 3.3 实时事件模型缺口

当前前端的实时模型是“全站共享 EventSource”:

- `frontend/src/hooks/useSSE.ts`

它假设后端会主动广播:

- `maid_update`
- `session_update`
- `metrics_update`
- `event_index_updated`
- `rp_message`

MaidsClaw 当前没有这个全局事件总线 HTTP 面。它有的是单次 turn 的流式响应，以及 request/session 维度的 inspect 查询。

这意味着至少要二选一:

- 在 MaidsClaw 控制面提供全局 SSE 聚合流
- 或者前端改成 request/session 驱动的拉取式刷新

### 3.4 安全边界缺口

当前 Dashboard 默认是本地控制台，不是裸服务:

- 只接受 loopback origin
- 所有写请求支持 `X-Confirm-Secret`
- OpenClaw gateway token 只在后端使用

MaidsClaw 当前 gateway 代码没有对等的 HTTP 控制面保护。

如果你打算“正式接入”且继续保留这个 Dashboard 作为运维入口，那这一层要么:

- 在 MaidsClaw 控制面补一层本地写保护/确认机制
- 或者把 gateway 与 admin-control-plane 明确分层，避免把运维写接口直接暴露为裸 gateway 能力

否则你会从“本地控制台”退化成“缺少操作保护的本地 API”。

### 3.5 部署与依赖缺口

当前项目 README 的运行假设是:

- Python 3.10+
- Node 只用于首次构建前端
- OpenClaw gateway 在 `18789`

MaidsClaw 的运行假设是:

- Bun
- PostgreSQL
- 可选 Rust native module
- 默认服务端口 `3000`

而且 MaidsClaw 的 turn settlement 明确已经要求 PG 路径，不再走 SQLite fallback。

如果采用“完全接入”路线，这一条的含义会更强:

- Python backend 不应再被视为正式运行所必需
- Dashboard 相关控制面也应随 MaidsClaw 一起部署、启动、观测
- 现有 `dashboard.db` 只能作为迁移期的派生缓存，不能继续扩大为长期事实源

直接证据:

- `README.md`
- `pyproject.toml`
- `D:\Projects\MaidsClaw\README.md`
- `D:\Projects\MaidsClaw\package.json`
- `D:\Projects\MaidsClaw\src\runtime\turn-service.ts`

## 4. P1 Gap

这些缺口不一定阻止“先接上”，但不补会导致大量页面能力残缺。

### 4.1 页面语义错位

| 页面 | 当前依赖 | 与 MaidsClaw 的匹配度 | 判断 |
| --- | --- | --- | --- |
| Grand Hall | maid 列表、session 列表、简化 transcript | 中 | 可保留 UI，需补 MaidsClaw 原生 list/transcript contract |
| Observatory | metrics、event_index、dispatch incidents | 中低 | 可重做为 health/logs/trace 面板 |
| War Room | conflict、delivery failure、dispatch incident | 低 | MaidsClaw 无同等概念，需要重新定义 |
| Garden | cron jobs、heartbeat 文件 | 低 | MaidsClaw 不是这套 cron/heartbeat 模型 |
| Library | lorebook、character card、match preview | 中 | 可复用页面意图，但要重做数据模型 |
| Kitchen | canon commit / world revision | 很低 | MaidsClaw 没有同构的 canon/branch/revision API |
| Ballroom | dashboard 自己维护的 RP 房间与消息库 | 很低 | 现有实现与 MaidsClaw session/turn 模型基本不是一回事 |

### 4.2 Lore / Persona 数据模型缺口

当前 Dashboard 的 `Library` 实际维护的是一套 dashboard 自己的 RP 数据:

- lore 存 SQLite，字段是 `body / triggers / match_type / insert_at / world_id`
- character 支持 V2 card import，并存在 SQLite

MaidsClaw 的模型是:

- lore 是文件化 `id / title / keywords / content / scope / enabled / priority`
- persona 是文件化 `id / name / description / persona / systemPrompt / messageExamples`
- agent 再通过 `personaId` 关联 persona

所以这里至少有三层 gap:

- 字段映射 gap
- 存储位置 gap
- 编辑入口 gap

如果你要保留 Library，建议把目标改成:

- 编辑 `config/lore.json` 或 `data/lore/*.json`
- 编辑 `config/personas.json`
- 增加 card -> persona 的导入转换

而不是继续沿用当前的 SQLite RP 库。

直接证据:

- `api/rp.py`
- `dashboard_db.py`
- `D:\Projects\MaidsClaw\src\lore\entry-schema.ts`
- `D:\Projects\MaidsClaw\src\persona\card-schema.ts`
- `D:\Projects\MaidsClaw\config\lore.example.json`
- `D:\Projects\MaidsClaw\config\personas.example.json`

### 4.3 Inspect 展示层缺口

MaidsClaw 已经有很强的 inspect 数据，但当前 Dashboard 没有按它的结构来画。

例如:

- transcript 是 `entries[]`，包含 `record_type / actor / payload`
- summary 有 `private_cognition_count / recovery_required / memory_flush / pending_sweep_state`
- memory 有 `core_memory_summary / recent_cognition / flush_state`
- trace/prompt/chunks/logs 都是 request 维度

这实际上很适合做一个新的 Observatory，但当前页面仍在围绕 `event_index`、`dispatch incidents`、OpenClaw 的运行事件来设计。

### 4.4 配置编辑缺口

当前 Dashboard 的配置页和后端 patch 逻辑是专门为 `openclaw.json` 写的，包括:

- binding patch
- model defaults patch
- allowAgents patch
- maid register 时创建 workspace/agentDir/sessionsDir

MaidsClaw 的配置体系不是这套:

- `config/agents.json`
- `config/personas.json`
- `config/lore.json`
- `config/providers.json`
- `config/auth.json`
- `config/runtime.json`

如果将来要做“控制台可编辑配置”，需要整套重设计，不能复用现有 `api/config.py`。

### 4.5 后端语言与模块边界缺口

如果不走 adapter，而是完全并入 MaidsClaw，那么当前 Dashboard 的 Python 后端模块基本都要重新归类:

- `api/*` 不再是目标实现位置
- `services/*` 中与 OpenClaw 绑定的逻辑不能原样搬运
- `dashboard_db.py` 代表的 SQLite 派生库模型要重新判断哪些仍需要、哪些应并入 PG 或 runtime inspect

这不是“把 Python 翻译成 TypeScript”这么简单，而是要先做模块归属收敛:

- agent/session/inspect/maintenance/config -> `MaidsClaw` 原生 admin facade
- OpenClaw 专属观测/canon/cron/heartbeat -> 删除或重定义
- 纯前端 UI 可继续复用，但要重绑新的 HTTP contract

## 5. P2 Gap

这些不是第一阶段必须，但如果目标是“完整替代现有控制台”，后续仍要补。

- 暴露 maintenance facade 为 HTTP API，例如 search rebuild / replay projection / rebuild derived
- 增加 agent CRUD HTTP 面，而不是只在 CLI 有概念
- 增加基于 MaidsClaw runtime 的全局事件聚合视图
- 重新定义 War Room，把“dispatch incident”改成真正和 MaidsClaw job / recovery / tool failure 对齐的异常面板
- 定义 Kitchen 的替代能力，如果你仍需要人工审阅 world-state 变更

## 6. 建议落地顺序

本节以下内容按“原生并入 MaidsClaw，不采用 adapter”制定。

### Phase 1: 定义 MaidsClaw 原生 Dashboard Contract

目标: 先把 Dashboard 所需控制面能力收敛成 MaidsClaw 自己的 HTTP/admin contract，而不是让 Python 侧代转。

- 在 `MaidsClaw/Bun` 侧定义 Dashboard 需要的 admin/read models
- 补齐最基本的 list 能力: `agents / sessions / transcript summary`
- 把现有 inspect 能力整理成 Dashboard 可直接消费的 view-model
- 定义全局实时方案: 原生 SSE 聚合流或明确的 polling contract
- 明确哪些页面暂时不可用，并在产品层面下线，而不是在 Python 侧兜底

Phase 1 结束标准:

- 前端不再依赖 OpenClaw root 或 Python 私有 API 语义
- Dashboard 关键数据都能直接从 MaidsClaw contract 获得
- 新增能力归属在 MaidsClaw 仓库，而不是 Dashboard Python 层

### Phase 2: 前端接线与页面重构

目标: 保留能复用的 UI，完成对 MaidsClaw contract 的前端重绑。

- Grand Hall 改到 MaidsClaw 的 `agents / sessions / transcript`
- Observatory 改到 `health / logs / trace / summary / memory`
- Library 改到 `persona / lore / agent-persona` 管理模型
- 下线或重写 Garden / Kitchen / Ballroom / War Room
- 删掉前端对 `/api/v1/stream` 全局广播语义的隐含依赖

### Phase 3: 数据与配置收敛

目标: 把 Dashboard 当前私有数据模型彻底并到 MaidsClaw。

- Library 不再写 `dashboard.db` 的 RP 表，而是写 MaidsClaw 的 persona/lore/config
- 配置编辑转向 `agents.json / personas.json / lore.json / providers.json / runtime.json`
- 明确是否还需要独立派生缓存；如需要，也归属 MaidsClaw
- 建立 card import -> persona/agent 的正式转换规则

### Phase 4: 退役 Python Backend 与 OpenClaw 语义

目标: 完成“完全接入”。

- 退役 Python/FastAPI backend
- 删除 OpenClaw 专属 API、配置 patch、文件路径假设
- 删除对 `openclaw.json / canon.db / cron/jobs.json / HEARTBEAT.md` 的正式依赖
- 把 maintenance / jobs / recovery 作为 MaidsClaw 原生控制面能力暴露
- 补齐 contract tests、UI e2e、迁移验证

## 7. 推荐裁剪

如果目标是尽快完成“原生接入”，我建议你先把页面分成两类:

保留并改造:

- Grand Hall
- Observatory
- Library

暂时降级或隐藏:

- War Room
- Garden
- Kitchen
- Ballroom

原因很简单: 前三者能较自然地映射到 MaidsClaw 的 session/inspect/config 体系；后四者目前都绑在 OpenClaw/canon/dashboard 自有 RP 模型上。

但这里要强调一点:

- “保留并改造”指的是保留前端交互意图和部分 UI 资产
- 不意味着保留 Python backend 或保留原有 OpenClaw API 语义

## 8. 一句话判断

这次接入不是“把当前 Dashboard 指向 MaidsClaw”，也不是“在中间加一个 adapter”。

更准确地说，是要把当前 Dashboard 从“OpenClaw 专用控制台”升级为“MaidsClaw 原生控制台”，其中最先要完成的是控制面归属迁移、HTTP contract 重定义、页面裁剪和 Python 后端退役路径。
