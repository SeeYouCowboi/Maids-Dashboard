# 端到端测试手册（Maids-Dashboard + MaidsClaw + rp:alice）

> 适用范围：在本地一次完整跑通 **dashboard 登录 → Grand Hall 开会话 → 真实模型对话 → Study room 验证记忆 → entity reconciliation 评估** 的全链路。

---

## 0. 测试前必须确认的一件事 ⚠️

**清记忆是一个破坏性操作。**

`scripts/wipe-rp-alice-pg.ts` 会把 `rp:alice` 这个 agent 在 Postgres 里的**全部**记忆、cognition、graph、session、还有整个 `jobs_current` / `job_attempts` 表清空。它会**临时禁用 append-only trigger** 才能 DELETE，wipe 完再重启 trigger。

**在跑这个脚本之前，自己先回答这三个问题：**

| 问题 | 如果答案是 yes |
|---|---|
| 我现在要测的是 **冷启动** 行为吗？（第一轮对话能不能正确建立 episode、cognition 这些） | ✅ 应该清 |
| 上一次测试有没有留下你**还想观察**的状态？（比如想看 entity reconciliation sweeper 在 30 turn 之后什么样子） | ❌ 不要清 |
| 当前 session 还**没结束**吗？（gateway 还在跑、dashboard 还连着）| ❌ 不要清，先关 gateway |

**如果你不确定：宁可不清。** 老数据不会污染新对话（每个 turn 是 append-only 的），最多让 Study 面板看起来杂一些。清掉之后**找不回来**。

如果你跟别人协作或者 share 同一个数据库：**清之前问对方一声**。

---

## 1. 前置环境

| 组件 | 版本/位置 | 启动方式 |
|---|---|---|
| Postgres | localhost:55432，db `maidsclaw_app`，用户 `maidsclaw`/`maidsclaw` | 自启 / docker 自管 |
| MaidsClaw gateway | `D:/Projects/MaidsClaw` | `cd /d/Projects/MaidsClaw && bun run src/index.ts` |
| Maids-Dashboard | `D:/Projects/Maids-Dashboard` | `cd /d/Projects/Maids-Dashboard && bun run dev` |
| Bearer token | `maidsclaw` | 已写入 `MaidsClaw/config/auth.json` |

**端口默认值**：
- gateway = `18790`
- dashboard dev server = `5173`
- postgres = `55432`

**前置检查命令**（开测前先跑一遍）：
```bash
# Postgres 通了吗
curl -s http://localhost:18790/v1/health 2>/dev/null || echo "gateway 没启动"

# Bearer token 有效吗
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer maidsclaw" \
  http://localhost:18790/v1/agents
# 期望：200
```

如果上面任何一项失败，**先解决基础设施**再继续，不要硬测。

---

## 2. 清理数据（如果你决定要清）

### 2.1 推荐方式：用 wipe 脚本

`scripts/wipe-rp-alice-pg.ts` 是 maintained 的脚本，处理了所有 edge case：
- 自动发现所有带 `agent_id` / `session_id` 列的表
- 自动 disable / re-enable append-only trigger
- 清 `jobs_current` + `job_attempts`（避免上一次 thinker 的 backlog 在新 session 里 replay）
- 只清 `rp:alice`，不影响其他 agent

```bash
cd /d/Projects/Maids-Dashboard
bun run scripts/wipe-rp-alice-pg.ts
```

**期望输出**：
```
tables with agent_id: [ ... 一长串表名 ... ]
tables with session_id only: [ ... ]
rp:alice sessions: N
  private_cognition_current: -X
  private_episode_events: -Y
  ...
  jobs_current: -Z (full truncate)
  job_attempts: -W (full truncate)
wipe OK
```

如果出现 `skipped (append-only): [...]` 列表，看一下里面是哪些表 —— 说明 trigger 临时禁用没成功。一般是因为 trigger 名字跟 `trg_${tbl}_no_delete` 这个约定不一样。这种情况告诉我，我帮你改脚本。

### 2.2 ⚠️ wipe 脚本**不会**碰的东西

- `entity_nodes` —— 这是手工策展的世界实体（Alice / 茶室 / 庄园 / ...），**永远保留**，wipe 不动它们
- `node_embeddings` 里属于 entity_nodes 的行（如果有）—— 同上
- 其他 agent 的数据
- gateway 配置 / persona / lore

如果你想**完全**重置，包括世界实体，那需要手动 `TRUNCATE entity_nodes CASCADE`，但我不建议 —— 那 6 行是手工 curated 的种子数据，丢了重建很麻烦。

### 2.3 万一脚本失败

最常见的原因是 gateway **还在持有 PG 连接**。先关 gateway，再 wipe，再启 gateway。

```bash
PID=$(netstat -ano | grep "LISTENING" | grep ":18790" | awk '{print $5}' | head -1)
powershell -Command "Stop-Process -Id $PID -Force"
sleep 1
bun run scripts/wipe-rp-alice-pg.ts
cd /d/Projects/MaidsClaw && bun run src/index.ts > /tmp/maidsclaw-gateway.log 2>&1 &
```

---

## 3. 启动序列

**正确的启动顺序（重要）**：

```
1. Postgres                    （应该已经在跑）
2. MaidsClaw gateway           （要等 PG 就绪后启动）
3. Maids-Dashboard dev server  （任何时候启动都行）
```

### 3.1 启动 gateway

```bash
cd /d/Projects/MaidsClaw
bun run src/index.ts
```

或者后台启动 + 日志写文件：
```bash
cd /d/Projects/MaidsClaw
bun run src/index.ts > /tmp/maidsclaw-gateway.log 2>&1 &
```

**就绪判定**（gateway 启动通常 < 2 秒）：
```bash
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer maidsclaw" http://localhost:18790/v1/agents)
  if [ "$code" = "200" ]; then echo "gateway ready"; break; fi
  sleep 1
done
```

### 3.2 启动 dashboard

```bash
cd /d/Projects/Maids-Dashboard
bun run dev
```

vite 一般 1-2 秒就 listen 上 5173。

### 3.3 浏览器登录

1. 打开 `http://localhost:5173`
2. 看到 "MaidsClaw Dashboard" 登录框
3. 输入 token：**`maidsclaw`**
4. 点 Connect

成功后看到 Welcome page 上 System Status 全绿（Gateway / Auth / Dashboard / MaidsClaw / API Base 五项）。

---

## 4. 端到端对话测试

### 4.1 进入 Grand Hall 选 agent

1. 左侧导航点 **Grand Hall**
2. 在 agent 列表里点 **rp:alice**
3. 看到 rp:alice 的 overview 卡片：persona、最近 sessions、活动状态

### 4.2 开一个新 session

1. 点 "New Session" 按钮（或类似入口）
2. dashboard 会调 `POST /v1/sessions { agent_id: "rp:alice" }`
3. 跳进 session 详情页

**网络层验证**：DevTools Network 应能看到：
```
POST /v1/sessions          → 200  返回 session_id
GET  /v1/sessions/{id}     → 200
```

### 4.3 真实对话（最少跑 5-10 turn）

在输入框依次发以下消息（每条等响应跑完再发下一条）：

```
1. 你好，今天庄园里安静得有点过头。
2. 桌上那块银怀表是从哪里来的？
3. 我让管家把它收进书房，你觉得合适吗？
4. 顺便去茶室准备点红茶吧。
5. 等等，先告诉我 Alice 现在在做什么。
```

每条消息会触发：
```
POST /v1/sessions/{id}/turns:stream   → SSE 200
  事件流：text deltas, tool calls, settlement, done
```

**观察重点**：
- 第一个 token 出现的延迟（TTFT）——通常 1-3 秒
- streaming 是不是连续的（typing dots → token 一个个吐出来）
- 最后看到 `done` 事件，对话完成
- 整个 turn 在 dashboard 上变成一个 user 消息 + assistant 消息的卡片对

如果某个 turn 卡住超过 60 秒，**先看 gateway 日志**（`/tmp/maidsclaw-gateway.log`），通常是 model provider 那边的事。

### 4.4 对话过程中可以并行做的检查

#### A. 在另一个标签页打开 Study room

`http://localhost:5173/study/rp%3Aalice/episodes`

每次发完一个 turn，回到这个页面**手动 refresh**（或等 30 秒自动 refresh），应该能看到新的 episode 卡片冒出来。

每条 episode 应该带：
- 类别 badge（speech / action / observation / state_change）
- 时间戳
- summary 文本
- 可能有 entity chips（teal 表示 raw pointer key，emerald 表示已经 resolve 到 entity_nodes 的 display name）

#### B. 直接看 DB

在另一个 shell：
```bash
cd /d/Projects/MaidsClaw
bun -e "
import postgres from 'postgres';
const sql = postgres('postgres://maidsclaw:maidsclaw@127.0.0.1:55432/maidsclaw_app');
const rows = await sql\`SELECT id, category, substring(summary, 1, 40) AS summary, entity_pointer_keys
                       FROM private_episode_events WHERE agent_id='rp:alice'
                       ORDER BY id DESC LIMIT 10\`;
console.log(JSON.stringify(rows, null, 2));
await sql.end();
"
```

应该能看到最新的 episode 行 + 它们的 `entity_pointer_keys` 数组。

---

## 5. 端到端验证 checklist

跑完 5-10 turn 之后，对照下面这份 checklist。每项都要过：

### 5.1 Gateway 层

```bash
# Episode endpoint 返回最新对话
curl -s -H "Authorization: Bearer maidsclaw" \
  "http://localhost:18790/v1/agents/rp:alice/memory/episodes?limit=20" \
  -o ./e2e-episodes.json

python -c "
import json
d = json.load(open('./e2e-episodes.json','rb'))
print('items:', len(d['items']))
print('with entity_refs:', sum(1 for i in d['items'] if i.get('entity_refs')))
print('resolved entities:', list((d.get('entity_refs_resolved') or {}).keys()))
"
```

**期望**：items > 0；至少几条带 entity_refs；可能看到 `loc:tea_room` / `char:alice` 这种 resolved 出来的项。

### 5.2 Dashboard 层

打开 `http://localhost:5173/study/rp%3Aalice/episodes`：

| 检查项 | 期望 |
|---|---|
| Episodes facet 显示新 episode 卡片 | ✅ |
| 每张卡片有 settlement / time / summary | ✅ |
| 至少几张卡片底部有 chip 区块 | ✅ |
| Chip 颜色：raw pointer key = teal，resolved = emerald | ✅ |
| Hover emerald chip 显示 `display_name · pointer_key · entity_type` | ✅ |
| 没有重复 chip（normalize + dedup 工作正常） | ✅ |

切到 `cognition` facet：应该看到 assertions / evaluations / commitments 列表，每条带 cognition_key 和 stance。

切到 `graph` facet：当前 entity_nodes 只有 6 行，所以 graph 视图可能是空的 —— 这是已知现象，不算 bug。

### 5.3 Cognition / 推理层

```bash
curl -s -H "Authorization: Bearer maidsclaw" \
  "http://localhost:18790/v1/agents/rp:alice/cognition/assertions?limit=10" \
  | python -m json.tool | head -50
```

**期望**：至少几条 assertion，每条有 `cognition_key`、`stance`、`content`。

### 5.4 Strategy B：entity reconciliation 干跑

```bash
curl -s -X POST -H "Authorization: Bearer maidsclaw" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true}' \
  http://localhost:18790/v1/admin/entity-reconciliation:run \
  -o ./e2e-recon.json

python -c "
import json
d = json.load(open('./e2e-recon.json','rb'))
print('thresholds:', d['thresholds'])
print('summary:', d['summary'])
print('candidate_keys:', d['candidate_keys'])
print()
print('top decisions:')
for x in d['decisions'][:10]:
    tgt = x.get('cluster_canonical') or x.get('best_match_pointer_key')
    print(f\"  {x['decision']:14s}  sim={x['similarity']:.3f}  {x['pointer_key']!r}  →  {tgt!r}\")
"
```

**期望**：
- `summary.merge` ≥ 1（至少 alice / 茶室 / 管家这一类 catalog 命中）
- `summary.cluster_merge` 可能 ≥ 0（如果有跨语言 / 同义变体）
- duration < 5s
- 每条决策的 `decision` 是 `merge` / `cluster_merge` / `borderline` / `new` 之一

如果 `summary.merge == 0`，可能是：
- 这一轮对话模型没用到任何已知 entity
- 或者 Bailian embedding API 调用失败 —— 看 gateway 日志

### 5.5 Bytes-on-disk smoke check

```bash
cd /d/Projects/MaidsClaw && bun -e "
import postgres from 'postgres';
const sql = postgres('postgres://maidsclaw:maidsclaw@127.0.0.1:55432/maidsclaw_app');
const counts = await sql\`
  SELECT 
    (SELECT count(*) FROM private_episode_events WHERE agent_id='rp:alice') AS episodes,
    (SELECT count(*) FROM private_cognition_current WHERE agent_id='rp:alice') AS cognition_current,
    (SELECT count(*) FROM private_cognition_events WHERE agent_id='rp:alice') AS cognition_events,
    (SELECT count(*) FROM sessions WHERE agent_id='rp:alice') AS sessions,
    (SELECT count(*) FROM jobs_current) AS jobs
\`;
console.log(counts[0]);
await sql.end();
"
```

**期望**：每项 > 0（`jobs` 通常会逐渐归零 —— async organize jobs 跑完就清掉）。

---

## 6. 测试结束后

### 6.1 干净退出

```bash
# 关 gateway
PID=$(netstat -ano | grep "LISTENING" | grep ":18790" | awk '{print $5}' | head -1)
powershell -Command "Stop-Process -Id $PID -Force"

# 关 dashboard dev server（如果不再用）
# 直接 Ctrl+C 那个 vite 进程
```

### 6.2 是否需要再清一次？

- 如果**只是这一轮测试**：不用清，留着观察
- 如果**马上要跑下一轮 cold-start 测试**：清，回到第 2 节
- 如果**这是一天测试的最后一次**：随你，留着方便明天接着看；清掉省 disk

### 6.3 留下证据（可选）

如果是为了写 bug report / sanity check：
```bash
# 把这次测试的 episode list / cognition / recon report 都存下来
mkdir -p ./e2e-evidence/$(date +%Y%m%d-%H%M)
mv ./e2e-episodes.json ./e2e-recon.json ./e2e-evidence/$(date +%Y%m%d-%H%M)/
```

---

## 7. 故障排查（按出现频率）

| 症状 | 可能原因 | 处理 |
|---|---|---|
| 登录后 System Status 显示 Auth = `Unauthenticated` | token 错了 / gateway `auth.json` 没用 `maidsclaw` | 检查 `MaidsClaw/config/auth.json` 第 16 行 |
| 所有 API 返回 401 | token 不匹配（最常见）/ token 过期 | 重新登录用 `maidsclaw` |
| 切页面 chip 不出现 | 对话还没产生 episode / Study refetch 没触发 | 手动按刷新按钮 |
| Episode 出现但 chip 全是 teal、emerald 一个都没有 | 模型没生成 entity_nodes 命中的 pointer key | 正常，不是 bug |
| Bailian embedding 报错 | API key 不对 / 网络不通 / 配额耗尽 | 看 gateway 日志，找 `BAILIAN_API_KEY` |
| Wipe 脚本 `skipped (append-only)` | trigger 名字约定不一致 | 报给我，我改脚本 |
| Gateway 起不来，报 `PgBackendFactory not initialized` | 启动顺序不对 / Postgres 没起 | 先确认 `postgres -p 55432` 在跑 |
| 对话跑到一半卡住超过 60 秒 | model provider 慢 / 网络断 | 看 `/tmp/maidsclaw-gateway.log` |
| Dashboard 显示 "Viewer context degraded" | session 还没建立 viewer scope | 正常的 cold-start 现象，发一两个 turn 后会消失 |

---

## 8. 常用命令速查

```bash
# === 检查 ===
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer maidsclaw" \
  http://localhost:18790/v1/agents

# === 清记忆 ===
cd /d/Projects/Maids-Dashboard
bun run scripts/wipe-rp-alice-pg.ts

# === 启 gateway ===
cd /d/Projects/MaidsClaw
bun run src/index.ts > /tmp/maidsclaw-gateway.log 2>&1 &

# === 启 dashboard ===
cd /d/Projects/Maids-Dashboard
bun run dev

# === 看 episode ===
curl -s -H "Authorization: Bearer maidsclaw" \
  "http://localhost:18790/v1/agents/rp:alice/memory/episodes?limit=20" \
  | python -m json.tool

# === 跑 entity reconciliation ===
curl -s -X POST -H "Authorization: Bearer maidsclaw" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true}' \
  http://localhost:18790/v1/admin/entity-reconciliation:run \
  | python -m json.tool

# === 关 gateway ===
PID=$(netstat -ano | grep "LISTENING" | grep ":18790" | awk '{print $5}' | head -1)
powershell -Command "Stop-Process -Id $PID -Force"
```

---

## 附录 A：测试涉及的核心表

| 表名 | 用途 | wipe 行为 |
|---|---|---|
| `sessions` | session 元数据 | 清 |
| `private_episode_events` | episode 主表（append-only） | trigger 临时禁用后清 |
| `private_cognition_current` | cognition 当前快照 | 清 |
| `private_cognition_events` | cognition 事件历史（append-only） | trigger 临时禁用后清 |
| `area_state_events` | area state（append-only） | trigger 临时禁用后清 |
| `entity_nodes` | 世界实体（手工策展） | **不清** |
| `node_embeddings` | 节点 embedding | 清（按 agent / session） |
| `jobs_current` / `job_attempts` | durable job 队列 | **整表 truncate** |

## 附录 B：dashboard 的几个 facet 路径

```
Welcome           /
Grand Hall        /grand-hall
Library           /library
Study             /study
  - Episodes      /study/{agent}/episodes
  - Cognition     /study/{agent}/cognition
  - Graph         /study/{agent}/graph
  - Narratives    /study/{agent}/narratives
  - Settlements   /study/{agent}/settlements
  - Pinned        /study/{agent}/pinned-summaries
  - Trace         /study/{agent}/retrieval-trace
Garden            /garden
War Room          /war-room
Observatory       /observatory
Ballroom          /ballroom
```

agent id 在 URL 里要 percent-encode：`rp:alice` → `rp%3Aalice`。
