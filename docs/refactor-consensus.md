# Maids-Dashboard × MaidsClaw 重构共识文档

> 本文档记录自顶向下访谈中已达成的架构决策。每个分支确认后追加一节。
> 未决项保留在末尾的 "待决清单" 中。

## 背景

当前 `Maids-Dashboard` 是 Python/FastAPI + React 的 OpenClaw 控制台。目标是重构为
`MaidsClaw` (`D:\Projects\MaidsClaw`) 的原生控制台：保留现有前端设计，后端与业务
逻辑全部针对 MaidsClaw 重写。旧 OpenClaw 专属模块（canon / plot_graph / drift_detector
/ delegation_classifier / lorebook_engine）视为遗产，不做移植。

两个项目保持独立仓库、独立进程。

---

## 已达成的决策

### 1. 项目使命：日常驾驶舱 (Cockpit)

Dashboard 的定位是**你本人日常运营 MaidsClaw 的主要入口**。既是观察台，也是
操作台：创建 session、发 turn、编辑 persona / lore、调度 job、查看并在必要时
回滚状态。`terminal-cli` 退居到脚本化 / 自动化场景。

**推论：**
- MaidsClaw gateway 需要在现有 14 条只读路由之上，补全写接口。
- 认证模型必须认真设计（不是纯只读那种随便放过）。
- 前端 8 个 Room 的设计投入会被完整消费，不会有一半 UI 被闲置。
- 非目标：**不**是多用户产品、**不**追求对外分发的产品级打磨。

### 2. 部署与连通性拓扑：SPA-only + 出网隧道

Dashboard **没有后端进程**。物理部署形态：

```
[浏览器] ──HTTPS──> [云服务器: 只托管 React 静态文件]
   │
   └──HTTPS(直连)──> [公网隧道] ──> [家里: MaidsClaw gateway]
```

- Dashboard 重构后**只剩前端**，云服务器继续由现有 CI 自动部署，但构建产物从
  "Python 后端 + 静态文件" 改为"纯静态文件"。
- 家里机器上的 MaidsClaw gateway 通过出网隧道获得一个稳定公网域名；**家里
  不开放任何入站端口、不需要公网 IP**。
- 浏览器拿到 SPA 后，API 请求**直连**该公网域名的 MaidsClaw gateway，不经过
  云服务器中转。
- MaidsClaw gateway 成为**唯一契约边界**。所有写接口、鉴权、CORS、速率限制都
  在 gateway 内实现一次。
- 家里离线时云端 SPA 仍可打开，表现为"MaidsClaw 离线"而非整站宕机。

**日常工作流**：
- **本地开发为主**：Vite dev server 跑在 localhost，SPA 直连
  `http://localhost:<fixed MaidsClaw dev port>`，无隧道、无 CORS 外部变量。
  这是主要的迭代和验证场。
- **云端为次要验证场**：本地跑通后推到云端，主要用来暴露"只在云端出现"的问题
  （隧道、跨域、构建差异、认证）。
- SPA 通过 `import.meta.env.VITE_API_BASE` 在构建期切换 API 基址：dev 模式指向
  localhost 固定端口，production 模式指向隧道域名。

**延迟决定的子项**（暂不锁定，后续单独讨论）：
- 具体隧道方案（Cloudflare Tunnel / Tailscale Funnel / 其他）
- 浏览器层的身份认证方案（Cloudflare Access / 纯 gateway token / OAuth 等）
- MaidsClaw 本地开发固定端口的具体数值（仅需一个不冲突的常量）

### 3. 仓库拓扑与类型同步：双仓独立 + `.maidsclaw-version` 锁定

两个 repo 物理独立，约定**同一父目录下的并排布局**（父目录具体路径不限）：

```
<任意父目录>/
├── MaidsClaw/          ← MaidsClaw 本体 (Bun + Rust)
└── Maids-Dashboard/    ← 纯 SPA 前端
    ├── .maidsclaw-version    ← 单行纯文本，锁定 MaidsClaw commit SHA
    └── tsconfig.json         ← paths 指向 ../MaidsClaw/src/
```

Dashboard 对 MaidsClaw 的引用始终通过**相对路径 `../MaidsClaw`**，不写死任何
绝对路径。开发者可以把这对 repo 放在任意位置，只要保持兄弟目录关系即可。

**本地开发**：
- 两个 repo clone 到同一父目录下（名字保持 `MaidsClaw` 和 `Maids-Dashboard`）
- Dashboard 通过 tsconfig paths / `file:` 协议从 `../MaidsClaw` 引用**类型与 zod
  schema**，运行时代码禁止跨仓 import
- 平时 MaidsClaw HEAD 怎么动，Dashboard `tsc` 立刻看到，零延迟迭代

**CI 部署**：
- GitHub Actions `actions/checkout@v4` 执行两次
- 第二次拉 MaidsClaw 时 `ref: $(cat .maidsclaw-version)`，严格还原本地验证时的
  那一个 commit，保证云端构建可复现
- Dashboard git log 里每一次 `bump maidsclaw to <sha>` 都是独立 commit，作为
  契约演进的时间线

**配套约束**：
- 红线：**Dashboard 只允许 `import type` 和纯数据常量（zod schema / 错误码枚举）**，
  任何带副作用、依赖 Bun/PG runtime 的代码严禁跨仓 import。由 tsconfig 和 eslint
  规则守住。
- 约定：`MaidsClaw` 和 `Maids-Dashboard` 两个目录位于同一父目录下的并排布局是
  固定前提；具体父目录路径不限，引用始终通过相对路径 `../MaidsClaw`。如果将来
  需要异地布局，由环境变量 override 兜底（暂不实现）。
- 工具：`scripts/bump-maidsclaw.sh` 把 `.maidsclaw-version` 更新到
  `../MaidsClaw` 的当前 HEAD，可选地跑 smoke build。

### 4. 数据面契约：严格 gateway-only + 双轨工程承诺

Dashboard 只通过 MaidsClaw HTTP gateway 访问 MaidsClaw。**没有任何旁路**——不直连
Postgres、不直接读 `config/*.json` 或 `data/` 下的文件、不碰 MaidsClaw 进程的
任何私有状态。这由 SPA-only 的部署形态天然强制（浏览器本来就做不到这些）。

**gateway 成为唯一契约边界**。所有认证、CORS、速率限制、审计日志、类型红线都在
gateway 一处实现。Dashboard 增加一个新功能 = MaidsClaw 增加一个新 gateway 路由 +
Dashboard 消费它。

**双轨工程承诺**：本次重构实际是两条工作线并行：
1. **MaidsClaw 侧 gateway 扩展计划**：在现有 14 条只读路由之上，补全 Cockpit
   需要的写接口（persona / lore / agent / provider / job / state / metrics 等）
2. **Dashboard 侧前端重写**：沿用现有 React 19 / Vite 6 / Tailwind v4 设计，把
   数据层从旧 OpenClaw 后端切到 MaidsClaw gateway，重做每个 Room 的语义

MaidsClaw 的 gateway 扩展属于 MaidsClaw 自身的独立工作项，Dashboard 只是它的第一
个消费方。

**已知的 MaidsClaw 存储现状**（探索结论，供后续实现参考）：
- 配置类数据是**文件形式**：`config/{personas,lore,providers,agents,runtime,auth}.json`
- Fallback：`data/personas/*.json`、`data/lore/*.json`
- 加载器全部是 `readFileSync` + schema 校验，**没有现成的写回能力**
- 运行状态主存储是 PostgreSQL（见 `src/storage/pg-app-schema-truth.ts`）
- `data/maidsclaw.db` 是 SQLite，承担某些子系统的本地状态（待进一步确认）
- 写接口的实现意味着 gateway 要承担"文件原子写回 + hot reload 触发"的新职责

### 5. Cockpit v1 能力范围 + 配套基础设施

#### 5.1 v1 功能档位总览

| # | 领域 | v1 档位 | v2 升级方向 |
|---|------|---------|-------------|
| 1 | Sessions（会话生命周期） | **Read + Write** | — |
| 2 | Requests（请求追溯 / 调试） | **Read-only** | — |
| 3 | Transcript / Memory（会话快照） | **Read-only** | — |
| 4 | Persona（RP 角色卡） | **Read + Write** | — |
| 5 | Lore（世界规则 / 关键词注入） | **Read + Write** | — |
| 6 | Agents / Providers / Runtime 配置 | **Read-only** | Write |
| 7 | Jobs（PgJobRunner 任务队列） | **Read-only** | Cancel / Retry |
| 8 | Blackboard / State（运行时共享状态） | **Read-only** | （谨慎考虑 Write） |
| 9 | Metrics（聚合指标） | **Defer** | 建立 metrics pipeline |

**v1 哲学**：让你能"**驾驶**"（发 turn、改角色卡、看问题），但**不能修改基础设施**
（改 provider、取消 job、写 state）。安全边界清晰，实现路径最短。

#### 5.2 v1 gateway 路由清单

**复用现有（14 条，零扩展）**：

```
GET    /healthz
GET    /readyz
POST   /v1/sessions
POST   /v1/sessions/{id}/turns:stream
POST   /v1/sessions/{id}/close
POST   /v1/sessions/{id}/recover
GET    /v1/requests/{id}/summary
GET    /v1/requests/{id}/prompt
GET    /v1/requests/{id}/chunks
GET    /v1/requests/{id}/diagnose
GET    /v1/requests/{id}/trace
GET    /v1/sessions/{id}/transcript
GET    /v1/sessions/{id}/memory
GET    /v1/logs
```

**v1 新增（~16 条）**：

```
# Sessions：补全列表查询（发 turn / 恢复已有路由）
GET    /v1/sessions                       # 当前活跃 + 最近关闭会话列表，支持过滤/分页

# Persona（CRUD）
GET    /v1/personas                       # 列表
GET    /v1/personas/{id}                  # 详情
POST   /v1/personas                       # 创建（body: CharacterCard）
PUT    /v1/personas/{id}                  # 替换（body: CharacterCard）
DELETE /v1/personas/{id}                  # 删除
POST   /v1/personas:reload                # 显式触发 hot reload（可选，正常由 write 自动触发）

# Lore（CRUD）
GET    /v1/lore                           # 列表，支持 scope / keyword 过滤
GET    /v1/lore/{id}                      # 详情
POST   /v1/lore                           # 创建
PUT    /v1/lore/{id}                      # 替换
DELETE /v1/lore/{id}                      # 删除

# 只读配置
GET    /v1/agents                         # agents.json 内容 + 运行时注册表
GET    /v1/providers                      # providers.json（secret 字段脱敏）
GET    /v1/runtime                        # runtime.json

# 只读 Jobs
GET    /v1/jobs                           # 列表，支持状态过滤
GET    /v1/jobs/{id}                      # 详情 + 历史

# 只读 State
GET    /v1/state/snapshot                 # blackboard 快照，支持 session_id 过滤
```

v1 gateway 总路由数：**约 30 条**。

#### 5.3 MaidsClaw 侧需要新增的基础设施

这些是 v1 双轨工程在 **MaidsClaw 仓** 内的前置投入，需要独立规划：

**5.3.1 原子配置写回工具（`src/config/atomic-writer.ts`，新）**
- 统一的 write 流程：`validate(schema) → write to tmp file → fsync → rename over original`
- 失败回滚：rename 前失败 → 删除 tmp；rename 后校验失败 → 从 `.bak` 恢复
- 每次写入前把旧文件 copy 到 `config/.backup/<name>.<timestamp>.json`，保留最近 N 份，作为一层人工回滚安全网
- 覆盖 `personas.json` 和 `lore.json` 两类；后续 v2 的 agents/providers 复用

**5.3.2 配置 hot reload 机制（`src/config/reloadable.ts`，新）**
- `ReloadableService` 接口：`reload(): Promise<ReloadResult>`
- `PersonaService` 和 `LoreService` 改造为实现该接口，加载器的结果缓存可被新加载结果原子替换
- 正在进行中的 session / turn 不受影响（使用 reload **前** 的快照）；下一个新 turn 使用新配置
- gateway 的 write 路由处理完文件写回后调用对应 service 的 `reload()`，返回新旧版本差异给客户端

**5.3.3 gateway 路由组织重构（`src/gateway/routes/*`，改）**
- 当前 `routes.ts` 是一个 `ROUTES` 数组 + 一堆 handler——扩到 30 条会难以维护
- 按领域分模块：`routes/sessions.ts`、`routes/personas.ts`、`routes/lore.ts`、`routes/requests.ts`、`routes/config.ts`、`routes/jobs.ts`、`routes/state.ts`
- 每个模块导出自己的 `RouteEntry[]`，由 `routes/index.ts` 合并
- 每条路由必须配套一份 zod schema（request body / query / response），作为类型契约的唯一来源

**5.3.4 请求校验中间件（`src/gateway/validate.ts`，新）**
- 统一的 "parse request → validate with zod → 401/422 错误响应" 流程
- 错误响应格式固定：`{ error: { code, message, details? } }`
- 错误码枚举导出为类型常量，Dashboard 端 `import type` 消费

**5.3.5 CORS 配置（`src/gateway/cors.ts`，新或改）**
- 允许 origin 白名单：`http://localhost:5173`（Vite dev default）+ 生产云端域名
- preflight（OPTIONS）处理
- 允许的 methods / headers 明确列出（避免反射 request headers）

**5.3.6 鉴权中间件挂载点（`src/gateway/auth.ts`，新骨架）**
- v1 阶段**保留旧的 bearer token 检查**作为兜底
- 预留 hook：请求上下文里挂一个 `principal` 字段，后续替换鉴权方案时只改这里
- 写接口和读接口走同一个中间件，写接口额外要求 `principal.scopes` 包含 `write`（v1 可以简化为 token 本身）

**5.3.7 审计日志（`src/gateway/audit.ts`，新）**
- 所有 write 路由的请求（method / path / principal / body hash / timestamp / 结果）写入 append-only 日志文件 `data/audit/gateway.jsonl`
- Dashboard 后续可以通过只读路由消费它做"最近操作回放"（v2）

**5.3.8 Sessions 列表查询能力（`src/session/repo.ts` 或 storage 层，改）**
- 现状 gateway 没有 `GET /v1/sessions`，只能按 id 查
- 需要在 storage 层增加 "list sessions with filter/pagination" 的查询能力
- 如果 session 元数据当前没有索引字段（如 status / updated_at），一并补上

**5.3.9 Jobs 查询能力（`src/jobs/pg-job-runner.ts` 周边，改）**
- 类似 5.3.8，PgJobRunner 当前可能没有面向外部的只读查询 API
- 需要一个 `JobQueryService` 暴露 list / detail，不触碰 job 的写路径

**5.3.10 State 快照序列化（`src/state/*`，改）**
- blackboard 内存结构需要一个稳定的 "snapshot to JSON" 方法
- 可能需要对 session-scoped state 做过滤（只暴露一个 session 相关的数据，不是全进程）

#### 5.4 Dashboard 侧需要新增的基础设施

**5.4.1 类型契约消费层（`src/contracts/`，新）**
- 从 `../MaidsClaw/src/gateway/routes/**/schema.ts` 通过 tsconfig paths `import type`
- 本仓再导出一层 namespace（`import { PersonaCard } from '@/contracts/persona'`）避免 UI 代码直接写长相对路径
- 禁止在 Dashboard 里重新定义任何已在 MaidsClaw 存在的类型

**5.4.2 HTTP 客户端层（`src/api/client.ts`，新）**
- 薄封装 `fetch`：base URL 来自 `import.meta.env.VITE_API_BASE`、带 auth header、统一错误解析
- 每个领域一个 module：`src/api/personas.ts`、`src/api/lore.ts`、`src/api/sessions.ts` 等
- 每个 module 的函数签名完全用 MaidsClaw 的 schema 类型，类型断裂在编译期暴露

**5.4.3 数据层 / 缓存策略**
- 引入 TanStack Query（React Query）或等价方案
- 每个 gateway 资源对应一个 query key 命名空间
- Persona/Lore 的写操作使用 optimistic update + invalidate-on-success
- 列表查询可按需 polling（见后续 Q6 的实时机制决定）

**5.4.4 表单层（persona/lore 编辑）**
- react-hook-form + zod resolver
- zod schema 直接来自 MaidsClaw contracts（5.4.1），前后端校验规则严格一致
- 失败时展示 gateway 返回的结构化错误（code / field / message）

**5.4.5 SSE / 流式消费层（为 turns:stream 准备）**
- 复用或改写现有 Dashboard 的 `sse_manager.py` 的前端对接逻辑
- 统一一个 `useEventSource(path)` hook，处理重连、背压、取消

**5.4.6 环境配置**
- `.env.development`：`VITE_API_BASE=http://localhost:<fixed port>`
- `.env.production`：`VITE_API_BASE=<隧道域名>`
- Vite 的 dev server proxy 可作为 CORS 备胎（若 gateway CORS 配置出问题时的临时绕路）

**5.4.7 离线 / 降级态**
- 顶层路由守卫：周期性 ping `/healthz`，失联时切入 "MaidsClaw offline" 降级 UI
- 各 Room 的缓存数据在离线期仍可只读展示，写操作被禁用并提示

**5.4.8 旧代码清理**
- Python 后端（`dashboard_backend.py`、`api/`、`gateway/`、`core/`、`services/` 等）整体删除
- `frontend/` 目录结构的 OpenClaw 专属逻辑（canon / plot / drift / delegation）从 Room 中摘除
- 保留纯 UI 层（组件、设计、tailwind 主题）

#### 5.5 v1 不做的内容（明确延后）

- Agents / Providers / Runtime / auth 的**写**接口
- Jobs 的 cancel / retry / 重新入队
- State 的**写**接口
- Metrics 采集层和聚合查询
- 多用户 / 多 principal 的细粒度权限
- gateway 写接口的速率限制细节（v1 用兜底 token 粗粒度保护）

### 6. 实时性机制：轮询为主 + turn 流专用 SSE

**turn 流式输出**沿用 MaidsClaw 现有的 SSE 能力：
- `POST /v1/sessions/{id}/turns:stream` 已在 `src/gateway/sse.ts` 实现为标准
  `text/event-stream`
- 只在"用户发起一个新 turn"的那一刻订阅，接收完整 assistant 输出后断开
- **不**作为"持续监听某 session 所有事件"的通道

**其他所有动态数据**使用 React Query / TanStack Query 的轮询机制，**MaidsClaw 侧
零新增实时基础设施**。

**默认轮询间隔**（可被每个 hook 按需 override）：

| 场景 | 间隔 |
|------|------|
| 前台活跃视图（正在查看的 Room） | 2 秒 |
| 后台 / 历史视图 | 30 秒 |
| 健康检查 `/healthz` | 10 秒 |
| 配置类数据（personas / lore / agents） | **不轮询**，只在 mutation 后 invalidate |

**行为约束**：
- 页面隐藏时暂停轮询：`refetchOnWindowFocus: true` + `refetchIntervalInBackground: false`
- 离线检测：`/healthz` 连续失败 N 次后进入"MaidsClaw offline"降级态
- 写操作成功后用 `invalidateQueries` 让相关 query 立即刷新，不等下次轮询

**v1 明确不做**：
- 通用事件总线 / firehose SSE 路由
- WebSocket 通道
- 跨 session 的全局实时仪表盘

这些在 v2 如确有需要，再按领域逐一升级（例如只为 Grand Hall 加一条 SSE 推送），
不需要全局替换。

### 7. Room 拓扑：9 个 Room 的 MaidsClaw 新语义

放弃旧 OpenClaw 语义（canon / plot graph / delegation classifier / cron / commit
editor / group RP），按 MaidsClaw 实际架构重新定义每个 Room 的职责。**新增 Study
（书房）承载记忆系统**，因为 MaidsClaw 的 memory 规模（50+ 文件 + 8 份架构文档）
远超 Library 的"作者编辑的静态知识"语义所能容纳。

#### 7.1 Room 总览

| # | Room | 定位 | 核心职责 |
|---|------|------|----------|
| 1 | **Welcome** | 入口 | 连接状态、快速导航、Dashboard 本身的版本与构建信息 |
| 2 | **Grand Hall** | 主交互 | Chat（直接对话 Maiden / RP Agent）、活跃与历史 session 浏览、agent registry 只读视图 |
| 3 | **Kitchen** | 副交互 | 定时任务 / 任务提交入口（**语义预留**，相关基础设施 v1 可能尚未就绪） |
| 4 | **Library** | 静态知识编辑 | Persona CRUD、Lore CRUD（作者手写 / 编辑的内容） |
| 5 | **Study** *(新增)* | 动态记忆浏览 | Agent 运行时记忆的浏览 / 检查 / 调试 |
| 6 | **Observatory** | 宏观观察 | 整体统计、活动时间线、健康度概览（高层视角） |
| 7 | **War Room** | 微观 debug | 错误、冲突、底层 trace、blackboard、Maiden 决策可视化（低层视角） |
| 8 | **Garden** | 系统设置 | Jobs 队列、运行时参数、provider 配置、Dashboard 本地偏好 |
| 9 | **Ballroom** | 未来预留 | 多 RP agent 交互、聊天、剧情演绎（**语义预留**，待 MaidsClaw 支持该架构后启用） |

#### 7.2 Room 详细职责

**1. Welcome**
- MaidsClaw gateway 连接状态（`/healthz`）
- Dashboard 自身版本号、当前 API base、当前认证状态
- 快速导航到其他 Room
- 首次登录时的引导

**2. Grand Hall —— 主交互**
- **Chat 区**：直接对话 Maiden / RP Agent 的主界面，消费
  `POST /v1/sessions/{id}/turns:stream`，复用 MaidsClaw 现有 SSE
- **Session 浏览**：活跃 + 历史 session 统一列表，按 persona / 时间 / 状态过滤；
  点击进入可看完整 transcript + memory snapshot
- **Agent Registry 只读视图**：展示当前注册的 agent（`maid:main`、`rp:<personaId>`、
  `task:<id>`）的在线状态、lifecycle、最近活动
- 数据源：`/v1/sessions`（新增 list）、`/v1/sessions/{id}/turns:stream`、
  `/v1/sessions/{id}/transcript`、`/v1/sessions/{id}/memory`、`/v1/agents`

**3. Kitchen —— 副交互（语义预留）**
- 设计意图：提交"定时任务 / 长期任务 / 非对话类任务"的入口，避免所有交互都挤进
  Grand Hall 的 chat 流
- v1 现状：**MaidsClaw 当前没有面向用户的定时任务 / 任务提交基础设施**。
  `src/jobs/` 下的 JobScheduler 是内部系统任务（记忆组织、embedding rebuild 等）
- v1 可选实现形态（待后续细化）：
  - (a) 占位 placeholder，写"v2 预留"
  - (b) 展示现有系统 job 的手动触发入口（例如"立刻重建 embedding"）
  - (c) 接入 `src/memory/task-agent.ts` 的 task 提交能力
- **Q8 会重新细化 Kitchen 的 v1 具体形态**

**4. Library —— Persona & Lore Studio**
- Persona 角色卡的列表 / 查看 / 创建 / 编辑 / 删除
- Lore 世界条目的列表 / 查看 / 创建 / 编辑 / 删除，支持 scope / keyword 过滤
- 编辑器采用结构化表单（react-hook-form + zod），schema 直接 import 自
  `../MaidsClaw/src/persona/card-schema.ts` 和 `../MaidsClaw/src/lore/entry-schema.ts`
- 保存时触发 gateway 的原子写回 + hot reload
- 数据源：`/v1/personas/*`、`/v1/lore/*`

**5. Study —— 记忆浏览（新增）**
- **Core Memory Blocks**：按 agent 分组，展示每个 block 的 label、内容、
  `chars_current / chars_limit`、最近修改（v1 只读，v2 允许 append / replace）
- **Episodes / Narratives**：时间轴形态展示 agent 累积的情节记忆和叙事记忆
- **Settlement Ledger**：展示 transient → durable 的记忆结算过程
- **Retrieval Trace**：对某个 turn 展示它检索到了哪些记忆块（和 Observatory /
  War Room 的 request 追溯联动）
- **Pinned Summaries**：展示被钉住的摘要建议及其状态
- **Visibility / Redaction 策略可视化**：看某个记忆在当前 agent 视角下是否可见
- v1 **纯只读**。v2 开放记忆编辑需要配合 MaidsClaw 的 write API 和审计日志
- 数据源：需要在 gateway 新增记忆只读路由（v1 gateway 扩展的一部分），底层可复用
  `src/app/inspect/inspect-query-service.ts` 的读模型

#### 7.3 Study Room 对 v1 gateway 路由清单的补充

Q5 的 v1 gateway 路由清单需要补充以下记忆只读路由：

```
GET /v1/agents/{agentId}/memory/core-blocks       # 核心记忆块列表
GET /v1/agents/{agentId}/memory/core-blocks/{label}  # 单个 block 详情
GET /v1/agents/{agentId}/memory/episodes          # 情节记忆时间轴
GET /v1/agents/{agentId}/memory/narratives        # 叙事记忆
GET /v1/agents/{agentId}/memory/settlements       # 结算账本
GET /v1/agents/{agentId}/memory/pinned-summaries  # 钉住的摘要
GET /v1/requests/{id}/retrieval-trace             # 某次 request 的检索详情
```

v1 gateway 路由总数因此从 ~30 调整为 **~37**。

#### 7.4 其余 Room 详细职责

**6. Observatory —— 宏观观察**
- 活动时间线（按小时 / 天聚合 session / turn 数量）
- 整体健康度卡片（MaidsClaw 在线时长、错误率、平均 latency——v1 从现有数据
  客户端聚合，v2 升级为真 metrics pipeline）
- Talker/Thinker 运行状态显示（enabled / disabled / staleness 等）
- Jobs 队列的宏观健康指标（pending / running / failed 数量趋势）
- **不负责**底层 trace 细节——那是 War Room 的事
- v1 数据源：`/v1/sessions`、`/v1/logs`、`/v1/jobs`、`/v1/runtime` 的客户端聚合；
  无真正的 metrics 接口（延后 v2）

**7. War Room —— 底层 debug**
- **Request Trace 详细视图**：消费 `/v1/requests/{id}/trace`，展示每次 request
  的完整事件链（prompt / chunks / diagnose）
- **Error / 异常事件流**：失败的 turn、dispatcher 错误、config 加载失败、
  gateway 返回 4xx/5xx 的历史
- **Blackboard Snapshot**：查看 `src/state/blackboard.ts` 的当前键值（按
  namespace 分组），支持按 session 过滤
- **Maiden 决策可视化**：展示 `DecisionPolicy` 的输入 / 输出、委托深度、目标
  agent；追溯"为什么这次 Maiden 自己回了而没委托给 Alice"
- **Trace Store 原始事件**：`src/app/diagnostics/trace-store.ts` 的原始 trace
  记录浏览
- v1 数据源：`/v1/requests/{id}/*`、`/v1/logs`、`/v1/state/snapshot`、
  `/v1/state/maiden-decisions`（新增）

**8. Garden —— Jobs + 系统设置**
- **Jobs 队列**：`PgJobRunner` 的队列状态、历史、失败详情（v1 只读）
- **Runtime Config 查看**：`runtime.json` 内容（v1 只读），包括 talker/thinker 开关
- **Providers 查看**：`providers.json` 内容（v1 只读，secret 脱敏）
- **Agents 配置查看**：`agents.json` 的 agent preset（v1 只读）
- **Dashboard 本地偏好**：主题、API base 切换、轮询间隔、CONFIRM_SECRET 管理
- v1 数据源：`/v1/jobs`、`/v1/runtime`、`/v1/providers`、`/v1/agents`

**9. Ballroom —— 未来预留**
- 设计意图：多 RP agent 交互、聊天、剧情演绎
- v1 现状：MaidsClaw **架构上**不支持多 RP agent 在同一 session 并发对话
- v1 形态：保留导航入口和 placeholder UI，写明 "Coming in v2"；或 v1 直接隐藏
  入口待基础设施就绪
- **Q8 会细化 Ballroom 的 v1 具体形态**

#### 7.5 Room 未解决的细项（延后讨论）

- Kitchen 的 v1 具体形态（纯 placeholder / 系统 job 手动触发 / task agent 提交入口）
- Ballroom 的 v1 具体形态（placeholder 可见 / 入口隐藏 / 极简 stub）
- Study 里各子视图的默认展示层级（先展示 core blocks 还是 timeline）
- War Room 内多个 debug 视图（trace / errors / blackboard / decisions）的 tab 组织
- Observatory 在 v1 没有真 metrics pipeline 的前提下如何避免"空壳感"

### 8. 客户端状态管理 —— 浏览器存储策略

Dashboard 是 SPA-only，浏览器里仍需存储若干类数据。按作用域分类管理：

#### 8.1 分类存储方案

| 类别 | 存储方式 | 内容示例 |
|------|---------|---------|
| **A. 认证凭证** | `sessionStorage` | gateway bearer token |
| **B. 用户偏好** | `localStorage` | 主题、API base、轮询间隔、默认过滤、上次看的 session id |
| **C. 查询缓存** | **纯内存**（React Query 默认） | Session 列表、persona 列表、trace 数据；v1 不 persist |
| **D. 编辑草稿** | `sessionStorage`（防抖写入） | Persona / Lore 编辑中的未保存内容、chat 输入框 |

#### 8.2 配套约定

1. **统一 storage 封装**：`src/lib/storage.ts` 提供 `getSession<T>(key)` /
   `setSession(key, value)` / `getLocal<T>(key)` / `setLocal(key, value)`，所有
   value 经过 zod 校验序列化 / 反序列化。**所有 Room 严禁直接调用 `localStorage.*`
   或 `sessionStorage.*`**——由 eslint 规则守住。

2. **Storage key 命名空间**：所有 key 加 `mc:` 前缀（例如 `mc:auth:token`、
   `mc:prefs:theme`、`mc:draft:persona:alice`），避免同域下将来部署其他工具时
   key 冲突。

3. **Schema migration**：每个持久化对象包装为 `{ version: number, data: T }`。
   反序列化时先检查 version；不匹配时 fallback 到默认值而**不是抛错**。升级时
   写一个简单的 `migrate(old) → new` 函数，覆盖已知旧版本。

4. **敏感数据零持久化**：Transcript、memory 内容、retrieval trace、任何可能包含
   RP 情景或被 redaction policy 覆盖的数据，**严禁**写入任何持久化层（localStorage /
   IndexedDB），只存在 React Query 内存缓存中。v2 如要 persist，必须配套加密 +
   TTL 策略并走单独设计评审。

5. **离线降级态**：MaidsClaw 失联时，React Query 内存缓存返回最后一次成功数据；
   每个 Room 根据 query 的 `isFetching` / `isError` / 最后成功时间显示"数据可能
   过期"提示。**不**主动向用户隐藏数据；**不**弹模态框干扰使用。写操作在离线
   期被禁用并提示"MaidsClaw 当前离线"。

6. **一键清空本地状态**：Dashboard 顶部提供一个 "Reset Local State" 按钮，清空
   所有 `mc:` 前缀的 key 作为出问题时的兜底。等价于 "注销 + 重置偏好"。

#### 8.3 延后到 Auth 讨论

`MAIDS_DASHBOARD_CONFIRM_SECRET` 这一层"写操作二次确认"机制是否保留、以什么形式
存在，和 gateway 鉴权方案（Cloudflare Access / bearer token / 其他）强耦合，
统一放到未来专门的 Auth 讨论里决定。

### 9. 迁移与 rollout 策略：并行分支 (Parallel Branch)

**不采用**增量 Room-by-Room 迁移——SPA-only 的决定让"保留 Python 后端做代理层"
自动出局；OpenClaw 与 MaidsClaw 概念不兼容（canon / plot / drift 无法平滑过渡
到 sessions / memory / blackboard），增量方案会在概念边界处卡住。

**采用**：开独立分支做彻底重写，切换时一次性硬切。

#### 9.1 分支模型

- 分支名：`refactor/maidsclaw`（从当前 `main` HEAD 开出）
- 重构期间 `main` 保持旧 OpenClaw Dashboard 不变，CI 继续部署 `main`，旧版 Dashboard
  在云端保持可用
- 新分支允许 force push（重构初期 git 历史可以自由 rebase / squash）
- 切换前禁止 merge 回 main；切换时做一次性硬切（squash merge 或 reset）
- 切换 commit 之前打 tag `pre-maidsclaw-refactor`，方便日后考古

#### 9.2 "v1 最小可用"切换触发条件

满足以下**全部**才做硬切换，否则留在分支继续做：

- [ ] MaidsClaw gateway 的 v1 新增路由（Q5 + Q7 所列 ~37 条）已在 MaidsClaw
      仓里落实
- [ ] Dashboard 侧 Welcome、Grand Hall、Library 三个 Room 能完整跑起来
- [ ] 端到端流程在本地验证通过：新建 session → chat → SSE 流式输出 → 编辑
      persona → hot reload → 新 chat 能看到新 persona 生效
- [ ] CI workflow 新版本在临时预览环境构建通过
- [ ] `.maidsclaw-version` 指向 MaidsClaw 的一个稳定 commit（非 WIP 状态）
- [ ] 旧 Python 代码已经从新分支**完全删除**，不是注释、不是保留以防万一
- [ ] `README.md`、`RUNBOOK.md`、`.env.example` 已同步更新

**不在切换前要求**：Study、Observatory、War Room、Garden、Kitchen、Ballroom 完成。
这些 Room 可以作为 follow-up PR 在切换之后补齐，切换时要求每个 Room 至少有
placeholder UI 不崩。

#### 9.3 CI workflow 切换

- 新分支里 `.github/workflows/deploy.yml` 改写为"纯静态部署"：
  `bun install && bun run build` → 上传 `dist/` 到云服务器
- 旧的 Python 构建 / 部署脚本（`deploy/`、Python setup 步骤、
  `static/` 预构建逻辑等）全部删除
- CI 里增加一步：`checkout` MaidsClaw 到相邻目录并 `git checkout $(cat .maidsclaw-version)`

#### 9.4 回退策略

- 切换后 7 天内发现致命问题，允许 `git revert` 整个切换 commit 回到旧 Python 版本
- 7 天后旧代码视为废弃，任何回退都从 git 历史人肉挑选
- 切换前的 `pre-maidsclaw-refactor` tag 在整个重构历史期间永不删除

#### 9.5 文档归档

切换完成后，`docs/refactor-consensus.md`（本文档）作为 v1 的实现指南**保留**在
`docs/` 下，不归档——它同时是 v2 规划的起点。

### 10. 开发工作流：测试、CI、lint、本地脚本

#### 10.1 测试策略

**原则**：薄测试，只守住"契约断裂"和"关键路径失效"。单人驾驶舱的正确性主要
靠日常使用 + 肉眼验证。

- **单元测试（Vitest）**：只覆盖
  - API 客户端的 request / response 解析（用假 fetch mock）
  - Zod schema 与 MaidsClaw 契约的兼容性（MaidsClaw schema 改动导致 Dashboard
    不能 parse 时第一时间炸）
  - `src/lib/storage.ts` 的 schema migration 逻辑
  - 纯计算函数（例如 Observatory 的客户端聚合）
- **组件测试**：v1 **不做**。UI 频繁变动下维护成本远大于收益
- **E2E**：v1 **不做**。依赖启动真实 MaidsClaw 成本高；靠日常使用验证
- **覆盖率**：不设数字目标。规则是"改了契约边界必须带单元测试覆盖"
- v2 如果要补 E2E，用 Playwright + 一条"session → chat → persona 编辑"关键路径

#### 10.2 CI workflow

**当前旧状态**（`refactor/maidsclaw` 分支切换时要全部替换）：
- Python 3.11 + Node 20 双栈构建
- 后端 pytest + 前端 `npm run build`
- 部署到 Ubuntu VM（`/opt/maids-dashboard`），systemd 管理 `maids-dashboard` 服务，
  后端跑在 `:18889`，静态文件在 `/var/www/maids-dashboard`

**新 workflow 结构**（GitHub Actions 单 workflow 单 job）：

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Dashboard
        uses: actions/checkout@v4
        with:
          path: Maids-Dashboard

      - name: Read MaidsClaw version
        id: mc_ver
        run: echo "sha=$(cat Maids-Dashboard/.maidsclaw-version)" >> $GITHUB_OUTPUT

      - name: Checkout MaidsClaw (pinned)
        uses: actions/checkout@v4
        with:
          repository: <owner>/MaidsClaw
          ref: ${{ steps.mc_ver.outputs.sha }}
          path: MaidsClaw
          token: ${{ secrets.MAIDSCLAW_REPO_TOKEN }}  # 若 MaidsClaw 为私有

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install
        working-directory: Maids-Dashboard
        run: bun install

      - name: Typecheck / Lint / Test
        working-directory: Maids-Dashboard
        run: |
          bun run typecheck
          bun run lint
          bun test

      - name: Build
        working-directory: Maids-Dashboard
        run: bun run build

      - name: Deploy (main only)
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: |
          rsync ... Maids-Dashboard/dist/ \
            user@host:/var/www/maids-dashboard/
          # 切换时 systemd 停用旧 maids-dashboard 服务并禁用：
          #   systemctl stop maids-dashboard && systemctl disable maids-dashboard
          # 之后纯 nginx 静态托管 /var/www/maids-dashboard
```

**切换时的服务器端一次性操作**（`deploy/DEPLOY_GUIDE.md` 新版本里写清楚）：
- `systemctl stop maids-dashboard && systemctl disable maids-dashboard`
- 删除 `/etc/systemd/system/maids-dashboard.service`
- 确认 nginx（或现有 webserver）继续从 `/var/www/maids-dashboard/` 服务静态文件，
  所有路径回落到 `index.html`（SPA 路由支持）
- 端口 `:18889` 释放，可供其他用途
- 不再需要 Python 运行时 / pip 依赖

**MaidsClaw 仓可见性待确认**：如果 MaidsClaw 是私有 repo，需要在 GitHub Secret
里配置一个有 read 权限的 PAT 或 deploy key（`MAIDSCLAW_REPO_TOKEN`）。

#### 10.3 Lint / Format / 类型红线

- **ESLint**（`typescript-eslint` + `eslint-plugin-react` + `eslint-plugin-react-hooks`），
  严格模式：
  - `@typescript-eslint/no-explicit-any`: error
  - `@typescript-eslint/no-unused-vars`: error
  - `no-restricted-imports`: 禁止从 `../MaidsClaw/src/**` 做运行时 import，
    只允许 `import type` 和 zod schema 常量。这条落实 Q3 "只 import type" 红线
  - `no-restricted-syntax`: 禁止直接访问 `window.localStorage` / `window.sessionStorage`
    / `globalThis.localStorage`，必须走 `src/lib/storage.ts`。这条落实 Q8 约定

- **Prettier**：默认配置 + `printWidth: 100`，配合 `eslint-config-prettier` 消除冲突

- **TypeScript strict**：
  - `strict: true`
  - `noUncheckedIndexedAccess: true`
  - `exactOptionalPropertyTypes: true`
  - `isolatedModules: true`（保证 `import type` 不会意外变成运行时导入）
  - `verbatimModuleSyntax: true`

#### 10.4 本地脚本与开发命令

`package.json` scripts：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src --max-warnings 0",
    "format": "prettier --write src",
    "typecheck": "tsc --noEmit",
    "bump:maidsclaw": "bash scripts/bump-maidsclaw.sh"
  }
}
```

**`scripts/bump-maidsclaw.sh`**：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d "../MaidsClaw" ]; then
  echo "Error: ../MaidsClaw not found next to this repo"; exit 1
fi
SHA=$(git -C ../MaidsClaw rev-parse HEAD)
echo "$SHA" > .maidsclaw-version
git add .maidsclaw-version
echo "Bumped MaidsClaw pin to $SHA"
if [[ "${1:-}" == "--build" ]]; then
  bun run build
fi
```

**本地开发启动流程**（README 新版记一条）：
1. 确保 `../MaidsClaw` 与本仓在同一父目录下
2. 在 MaidsClaw 目录启动 MaidsClaw 进程，监听固定开发端口
3. 在本仓 `bun run dev`，Vite dev server 起在 `http://localhost:5173`
4. 浏览器打开 `http://localhost:5173`，API base 自动指向本地 MaidsClaw

- **不**提供 `dev:all` 聚合命令——两个进程独立终端最清晰
- **不**使用 pre-commit hook（`husky` / `lint-staged`）；push 前手动 `bun run lint && bun run typecheck` 即可

#### 10.5 错误观测

v1 **不接**外部错误监控（Sentry / Datadog / 其他）。

- 顶层 `<ErrorBoundary>`：捕获未处理 React 错误，展示"出错了"兜底页 + console 打印
- API 层统一处理 fetch / SSE 失败，写 console + React Query error state
- 浏览器 DevTools 足够单人驾驶舱的排查需求
- v2 如果要对外分发或多人使用再考虑接入 Sentry 等方案

### 11. Room 内部细项

基于 Q7 保留的 5 个 Room 细项，全部采用 Q11 访谈中的推荐方案：

#### 11.1 Kitchen v1 形态：纯 placeholder

- Kitchen 导航入口保留，页面内容是静态说明 + 规划图：
  - 标题："Kitchen — Task Submission"
  - 副标题："Reserved for scheduled tasks and one-shot task agent submission"
  - 内容：简要描述 v2 计划（task agent 提交 + 结果回收 + 定时任务管理），附带
    一张规划示意图（SVG 或占位图）
  - 标注："Coming in v2"
- v1 **不**新增 gateway 路由为 Kitchen 服务
- v2 方向：复用 `src/memory/task-agent.ts` 或 `task:runner` ephemeral agent，
  新增 gateway 路由实现"提交任务 → 结果回收"闭环

#### 11.2 Ballroom v1 形态：可见 placeholder

- Ballroom 导航入口保留（**不**隐藏），保持 8 Room 视觉对称
- 页面内容为静态说明：
  - 标题："Ballroom — Multi-Agent Interaction"
  - 副标题："Reserved for multi-RP agent dialogue, scene orchestration, and
    ensemble storytelling"
  - 内容：列出 v2 规划的能力（多 RP agent 共享 session、剧情编排、场景状态）
  - 标注："Requires MaidsClaw architecture extensions — coming in v2+"
- v1 **不**尝试做假多 agent 并排展示（避免用户误以为已可用）
- v2 启用前提：MaidsClaw 架构层面支持多 RP agent 并发对话

#### 11.3 Study 默认布局：双栏 (agent 列表 + 记忆维度)

```
┌─────────────────────────┬─────────────────────────────────┐
│ Agents                  │ Alice (rp:alice)                │
│ ─────────               │ ─────────────────────────────   │
│ ▸ maid:main             │ [Core Blocks] Episodes Narratives│
│ ▸ rp:alice       *      │   Settlements  Pinned  Retrieval│
│ ▸ rp:bob                │                                 │
│ ▸ task:runner           │ ┌─ persona block ──────────┐    │
│                         │ │ chars: 1523 / 2000       │    │
│                         │ │ Alice is a professional  │    │
│                         │ │ and cheerful maid...     │    │
│                         │ └──────────────────────────┘    │
│                         │                                 │
│                         │ ┌─ user block ─────────────┐    │
│                         │ │ chars: 867 / 2000        │    │
│                         │ │ The user is TeaCat...    │    │
│                         │ └──────────────────────────┘    │
└─────────────────────────┴─────────────────────────────────┘
```

- **左栏**：agent 列表，数据源 `/v1/agents`，实时显示活跃状态
- **右栏**：
  - 默认 tab **Core Memory Blocks**（最"结构化"、最像角色档案）
  - 其他 tab：`Episodes` / `Narratives` / `Settlements` / `Pinned Summaries` /
    `Retrieval Trace`
- 点击左栏 agent 切换右栏上下文；右栏 tab 状态保留（切 agent 时保持当前 tab）
- **Retrieval Trace** tab 不是 Study 主入口——支持从 Observatory / War Room 的
  request 详情"追过来"，Study 里作为只读浏览
- v1 全部**只读**；v2 开放 Core Blocks 的 append / replace 编辑

#### 11.4 War Room 组织：两大分区 (Event Stream + State Inspector)

```
┌────────────────────────────────────────────────────────────┐
│ [Event Stream]  [State Inspector]                          │
│ ═══════════════                                            │
│ { Logs | Errors | Failed Requests }                        │
│                                                            │
│ (timeline / event list)                                    │
└────────────────────────────────────────────────────────────┘
```

**使用心理模型**：
- **Event Stream**（时间序列视角）：回答"出了什么问题"
  - sub-tab `Logs`：`/v1/logs` 的实时 tail，支持按 level / agent 过滤
  - sub-tab `Errors`：MaidsClaw gateway 返回 4xx/5xx 的历史 + 应用层错误事件
  - sub-tab `Failed Requests`：request diagnose 失败或 chunks 中带 error 的记录
- **State Inspector**（快照视角）：回答"现在什么状态"
  - sub-tab `Blackboard`：`src/state/blackboard.ts` 的当前键值，按 namespace 分组
  - sub-tab `Maiden Decisions`：`DecisionPolicy` 的输入 / 输出历史 + delegation
    depth 追溯
  - sub-tab `Raw Traces`：`src/app/diagnostics/trace-store.ts` 原始事件浏览

**交互约定**：
- 顶部两大分区用顶部大 tab 切换
- 每个分区的 sub-tab 用次级 segmented control
- 从 Observatory 的某条错误跳转到 War Room 时，自动定位到对应分区 + sub-tab

#### 11.5 Observatory v1 "空壳"对策：混合布局

```
┌──────────────────────────────────────────────────────────┐
│ ┌──────┬──────┬──────┬──────┐                            │
│ │Uptime│Turns │Errors│ Jobs │   (Health Cards 顶部行)    │
│ └──────┴──────┴──────┴──────┘                            │
│                                                          │
│ Activity Timeline (24h)                                  │
│ ─────────────────────────────────────                    │
│ (session starts, turn spikes, error markers)             │
│                                                          │
│ Weekly Snapshot ─── from aggregated /v1/* data           │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                   │
│ │Top Persona│ │Turn Dist │ │Job Failures│                │
│ └──────────┘ └──────────┘ └──────────┘                   │
│                                                          │
│ ⓘ More metrics coming with MaidsClaw metrics pipeline    │
│   (v2)                                                   │
└──────────────────────────────────────────────────────────┘
```

**顶部 Health Cards**（4 张）：
- `MaidsClaw Uptime`：从 `/healthz` 的 started_at 计算
- `Turns Today`：当日 turn 总数（客户端聚合）
- `Errors Today`：当日失败 request 数
- `Jobs Pending / Failed`：从 `/v1/jobs` 聚合

**中部 Activity Timeline**：
- 最近 24 小时的活动：session 开启、turn 峰值、错误标记
- 数据源：`/v1/sessions`、`/v1/logs` 的客户端聚合

**底部 Weekly Snapshot**：
- 6-8 个小图，从现有数据客户端聚合：`Top Persona`、`Turn Distribution by Hour`、
  `Job Failure Reasons`、`Most Active Sessions`、`Request Latency Histogram`（如
  trace 里有 timing 数据）等
- 每个小图带"数据来源"说明，透明可追溯

**底部明确注明**：`ⓘ More metrics coming with MaidsClaw metrics pipeline (v2)` ——
诚实标明 v1 限制，同时为 v2 留钩子。

### 12. 认证与信任模型（架构级决策）

具体的隧道与 SSO 选型在落地时二次确认；下面是**架构层面的承诺**，为实现者提供
骨架。

#### 12.1 三层信任模型

```
┌──────────────────────────────────────────────┐
│  Layer 1: Identity (边界)                    │
│   - 本地开发: 跳过 (localhost 可信)          │
│   - 云端生产: 隧道层 SSO (Cloudflare Access  │
│     或等价方案)，Google/GitHub 登录          │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│  Layer 2: Authorization (API 访问)           │
│   - MaidsClaw gateway bearer token           │
│   - Token 来源: config/auth.json             │
│   - SPA 存储: sessionStorage (Q8)            │
│   - 首次访问时 login screen 输入一次         │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│  Layer 3: Write Confirmation (防误操作)      │
│   - UI 级 confirmation dialog                │
│   - 不再使用 MAIDS_DASHBOARD_CONFIRM_SECRET  │
│   - 破坏性操作 (DELETE / overwrite) 强制     │
│     二次确认，展示将被影响的对象             │
└──────────────────────────────────────────────┘
```

#### 12.2 每层的落地约束

**Layer 1 — Identity（身份）**
- 本地开发：MaidsClaw gateway 仅监听 `127.0.0.1`，或由环境变量放行 `localhost`
  origin。无 SSO，无身份层——单人本机环境视为可信
- 云端生产：**推荐 Cloudflare Tunnel + Cloudflare Access**
  - 理由：免费层支持单用户；自动 TLS；Access 提供 Google / GitHub SSO 不需自写
    登录页；穿透 CGNAT 无需端口转发
  - 备选：Tailscale Funnel（需手机端 Tailscale 客户端，体验稍逊）
  - 具体选型待首次部署时确认
- Layer 1 的失败 = 浏览器根本无法到达 MaidsClaw gateway

**Layer 2 — Authorization（授权）**
- MaidsClaw gateway 使用 bearer token，来源 `config/auth.json`（文件已存在）
- Token 可轮换；轮换时 gateway 支持热加载
- Dashboard 首次访问时显示一个极简 login screen：一个 token 输入框 + "Remember
  in this tab" 复选框（默认勾选）→ 存入 `sessionStorage`（Q8 约定）
- 所有 gateway 请求自动附带 `Authorization: Bearer <token>`
- 401 响应时 Dashboard 清空 token 并返回 login screen
- gateway 所有 write 路由要求 `principal.scopes` 包含 `write`；v1 token 一刀切
  带 `write` scope，v2 可引入细粒度

**Layer 3 — Write Confirmation（防误操作）**
- 取代旧的 `MAIDS_DASHBOARD_CONFIRM_SECRET` 机制
- **破坏性操作**（删除 persona、删除 lore entry、关闭 session、取消 job）：
  必须弹 confirmation dialog
  - 展示将被影响对象的名称 / ID
  - 要求用户在输入框中**键入被删除对象的名字**后才启用"确认"按钮（类似 GitHub
    repo delete 体验）
- **覆盖性操作**（更新 persona / lore）：展示 diff 预览，"确认保存" 按钮
- **幂等性操作**（创建、只读）：不需要二次确认
- Confirmation dialog 的文案按操作类型区分；不搞通用 "Are you sure?"

#### 12.3 Token 生命周期与风险

- **Token 存储位置**：`sessionStorage`（Q8 A 类）
- **XSS 风险**：存在。Dashboard 严格禁用 `dangerouslySetInnerHTML`、所有用户输入
  在渲染前 escape、Persona / Lore 内容作为纯文本展示（不允许嵌 HTML）
- **Token 泄漏响应**：用户手动在 `config/auth.json` 里轮换 token，重启 MaidsClaw
  gateway 进程或触发 auth reload；Dashboard 端自动 401 → 重新 login
- **CSRF 风险**：SPA 的 `Authorization` header 不会被浏览器跨站自动附加，CSRF 低
  风险；仍然强制要求 gateway CORS 白名单 + credentials: 'omit'
- **HTTPS only**：生产环境隧道层强制 HTTPS；Dashboard 发现当前 URL 是 HTTP 且
  host 非 `localhost` 时拒绝发送 token

#### 12.4 待落地时二次确认的具体选型

- 隧道：Cloudflare Tunnel vs Tailscale Funnel vs 其他
- Layer 1 SSO 提供商：Google / GitHub / Microsoft
- Cloudflare Access policy 的具体 email allowlist
- Token 轮换流程是否自动化

这些**不**影响架构决策本身，只影响实现细节。重构实现阶段第一次部署到云端时
再确认。

### 13. 其他决策 (杂项)

#### 13.1 命名与品牌

- **项目名称**：继续沿用 `Maids-Dashboard` / `Maids Dashboard`
  - 理由：宅邸 / 女仆 / 房间的视觉隐喻与 MaidsClaw 的 household 主题完美契合；
    重命名会丢失品牌识别
- **副标题 / tagline**：由 "Local control plane for OpenClaw" 改为
  `"Native console for MaidsClaw"`
- **版本起点**：v1 从 `2.0.0` 开始
  - 理由：与旧 OpenClaw Dashboard 的 1.x 做明确版本切分；语义上"大版本"对应
    "驱动器彻底变更"；切换 commit 前 main 的最后一个 tag 是 1.x
- **Room 命名**：保留英文 Room 名（Welcome / Grand Hall / Kitchen / Library /
  Study / Observatory / War Room / Garden / Ballroom），UI 内中文描述作为副标题

#### 13.2 国际化 (i18n)

- **v1**：英文界面为主，UI 字符串**不**抽离到 i18n 资源文件
- **v2**：如果需要中文界面，引入 `i18next` 或 `react-intl`，把 UI 字符串集中
  到 `src/locales/{en,zh}.json`
- **理由**：单人项目、你本人可读英文；i18n 框架的前置成本对 v1 不值

#### 13.3 可访问性 (a11y)

- **v1 基线**：
  - 所有按钮、输入框、表单控件有 label
  - 键盘可导航（Tab 顺序合理）
  - 颜色对比度满足 WCAG AA
  - 不依赖纯色传达含义（错误状态除了红色也要有 icon / 文字）
- **v1 不做**：
  - 正式 a11y audit
  - 屏幕阅读器完整测试
  - 高对比度专用主题
- 单人驾驶舱下这些是"默认好习惯"，不作为硬性门槛

#### 13.4 性能预算

- **v1**：不设定正式性能预算（Lighthouse 分数、bundle 大小门槛等）
- **软要求**：
  - Vite dev server 启动 < 3s
  - 初次页面加载在本地 < 500ms
  - Chat 发送到首个 token 流出 < 1s（受 MaidsClaw 模型响应时间主导）
  - bundle 大小控制在合理范围（< 2MB gzipped 作为软上限）
- 性能问题**发现时再处理**，不预先优化

#### 13.5 Dashboard 自身的 versioning

- **Semver**：`MAJOR.MINOR.PATCH`
- **起点**：`2.0.0`
- **MAJOR**：MaidsClaw gateway 契约不兼容变更 / 重大 Room 结构调整
- **MINOR**：新 Room / 新功能 / 向后兼容增强
- **PATCH**：bug 修复、样式调整、文案修改
- **.maidsclaw-version 与 Dashboard 版本无耦合关系**——MaidsClaw pin 可以在 MINOR
  / PATCH 间自由升降

#### 13.6 依赖管理与 Bun

- **包管理器**：Bun（与 MaidsClaw 一致，减少栈割裂）
- **package.json engines**：`"bun": ">=1.0.0"`
- **禁用 npm / yarn / pnpm lockfile**：`.gitignore` 里保留 `bun.lockb`，忽略
  其他 lockfile，避免多包管理器污染
- **Node 版本**：不强制要求 Node（Bun 原生运行），但 GitHub Actions 中使用
  `oven-sh/setup-bun@v1`

#### 13.7 SPA 路由

- **路由库**：`react-router` v7（或等价）
- **路由风格**：BrowserRouter，URL 反映当前 Room 和子状态
  - `/` → Welcome
  - `/grand-hall` → Grand Hall
  - `/grand-hall/sessions/:id` → 某具体 session 的 chat / transcript
  - `/library/personas/:id` → persona 编辑
  - `/study/:agentId/core-blocks` → Study 某 agent 的 core blocks tab
  - ...
- **优点**：可分享链接、可浏览器后退前进、可 bookmark
- **nginx 配置**：切换时的 nginx 需支持 SPA fallback，所有未命中静态文件的路径
  返回 `index.html`（已在 Q10 CI 切换 checklist 中注明）

#### 13.8 CSS / 样式

- 沿用 **Tailwind CSS v4**（现有设计已投入）
- 组件库：不引入第三方 UI 组件库（Radix / Shadcn 等可以作为**原语**使用，但不
  依赖任何整体风格的组件库），保持现有视觉设计主导权
- 图标：`lucide-react` 或同等轻量图标库
- 动画：`motion/react`（即 framer-motion，现有设计已用）
- 图表：`recharts`（现有设计已用）

#### 13.9 MaidsClaw 本地开发固定端口

- **约定值**：`18790`（与旧 Dashboard `:18889` 错开一格，且与 OpenClaw gateway
  `:18789` 错开一格）
- MaidsClaw 的 gateway 在本地开发时监听这个端口
- Dashboard `.env.development` 写入 `VITE_API_BASE=http://localhost:18790`
- 具体数值**不是硬约束**——如果 MaidsClaw 团队选了其他值，改 `.env.development`
  即可；但必须是**一个固定值**，不要每次启动都变

### 14. 实现阶段的 "已决 / 待定" 边界

以下事项虽然在本文档里已有方向，但**实现细节**留到落地时再定，不阻塞 v1 开工：

- Cloudflare Tunnel vs Tailscale Funnel 的最终选型
- Cloudflare Access SSO 提供商和 email allowlist
- MaidsClaw repo 的 GitHub 可见性（public / private），以及对应的 CI PAT 配置
- 云服务器上 nginx 的具体配置（SPA fallback、Cache-Control、CSP header 等）
- MaidsClaw 本地开发固定端口的具体数字（建议 18790，可由 MaidsClaw 团队调整）
- Kitchen / Ballroom 在 v2 启用时的具体路由设计
- Metrics pipeline 在 v2 的具体架构（MaidsClaw 侧 metrics 层 + Dashboard 侧
  消费层）

这些不是**决策空缺**，而是**实现时机未到**——决策条件已经明确，实现者按本文档
的约束去填具体值即可。

---

## 决策索引

| # | 分支 | 章节 | 结论 |
|---|------|------|------|
| 1 | 项目使命 | §1 | 日常驾驶舱 (Cockpit) |
| 2 | 部署与连通性 | §2 | SPA-only + 出网隧道，云端只托管静态文件 |
| 3 | 仓库拓扑 / 类型同步 | §3 | 双仓独立 + 同级父目录 + `.maidsclaw-version` 锁定 |
| 4 | 数据面契约 | §4 | 严格 gateway-only + 双轨工程承诺 |
| 5 | v1 能力范围 + 基础设施 | §5 | Sessions/Persona/Lore R/W；其余只读；~37 条 gateway 路由 |
| 6 | 实时性机制 | §6 | turn 流沿用 SSE；其余 React Query 轮询 |
| 7 | Room 拓扑 (9 Room) | §7 | 新增 Study；Chat 落在 Grand Hall；各 Room 按 MaidsClaw 语义重定义 |
| 8 | 客户端状态管理 | §8 | sessionStorage/localStorage/内存/sessionStorage 按类别 |
| 9 | 迁移策略 | §9 | 并行分支 `refactor/maidsclaw` + 一次性硬切 |
| 10 | 开发工作流 | §10 | 薄测试；单 workflow CI；ESLint 严格；Bun 脚本 |
| 11 | Room 内部细项 | §11 | Kitchen/Ballroom placeholder；Study 双栏；War Room 两分区；Observatory 混合布局 |
| 12 | 认证与信任模型 | §12 | 三层模型：Tunnel SSO / gateway token / UI 确认 |
| 13 | 杂项 | §13 | Maids Dashboard 品牌保留；v2.0.0 起点；Semver；Bun；react-router v7 |

**状态**：v1 所有架构决策已完成，可以进入实现阶段。

**实现时机再确认的事项**（非决策空缺，见 §14）：
- 隧道选型与 SSO 配置
- MaidsClaw repo 可见性与 CI PAT
- nginx 具体配置
- 本地开发端口具体数值

---

## 变更记录

- 初稿：自顶向下访谈，14 节决策全部落地
- 归档说明：本文档在切换到 MaidsClaw v1 后**保留在 `docs/`**，作为 v1 的实现
  指南和 v2 规划起点；不归档
