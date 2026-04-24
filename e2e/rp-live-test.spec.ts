/**
 * MaidsClaw RP Live Test — 150-turn 庄园女仆对话
 *
 * Uses real rp:mei agent via browser chat UI.
 * Sends all 150 turns in sequence, captures each response, auto-evaluates
 * all ⚠️ verification points and 🔀 confusion-injection points, and writes
 * a scored report.
 *
 * Coverage map:
 *   - Phase A-R  (1-120):   Existing baseline — memory / reference / constraint /
 *                            confusion injections. 29 verification points.
 *   - Phase S    (121-135): Action Capability — narrated action → scene-fact
 *                            projection → time-stable recall. Validates
 *                            Task 5/6/7 of the three-layer cognition rollout
 *                            (possession + status_change → scene_area_fact_*).
 *   - Phase T    (136-145): Speaker Normalization Gates — question/hypothesis/
 *                            confusion/quoted_speech/correction-alone must NOT
 *                            mutate scene facts. Validates Task 2/3/5.
 *   - Phase U    (146-150): Integrated Cognition Marathon — cross-layer recall
 *                            and constraint summary. Validates divergence
 *                            behavior (Task 9) and cognition hygiene.
 *
 * Prerequisites (must be running):
 *   - Local PostgreSQL: 127.0.0.1:5432  db=maidsclaw_app  user=maidsclaw
 *       Wipe before run: PG_APP_URL=postgres://maidsclaw:maidsclaw@127.0.0.1:5432/maidsclaw_app \
 *                        bun scripts/wipe-all-runtime-pg.ts  (in MaidsClaw repo)
 *   - MaidsClaw gateway: bun run start  (port 18790, reads PG_APP_URL from .env)
 *   - Dashboard dev server: npm run dev  (port 5173, in Maids-Dashboard repo)
 *   - rp_agent:mei configured in MaidsClaw config/agents.json
 *
 * Environment:
 *   E2E_TOKEN     bearer token (default: "maidsclaw")
 *   RP_MAX_TURNS  how many turns to run  (default: 10 for quick smoke, 150 for full)
 *   PG_APP_URL    override DB URL (default: postgres://maidsclaw:maidsclaw@127.0.0.1:5432/maidsclaw_app)
 *
 * Estimated runtime: 65-115 minutes (150 real model calls)
 */

import { expect, test, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const TOKEN = process.env.E2E_TOKEN ?? 'maidsclaw'

// 120-minute global timeout for the full 150-turn run.
// NOTE: calling test.setTimeout() at module scope does NOT reliably override
// the config default on all Playwright versions — Playwright only guarantees
// it when called inside a test body. We use describe.configure() here so the
// timeout is set before tests enumerate.
test.describe.configure({ timeout: 120 * 60 * 1000 })

// ── Turn list ─────────────────────────────────────────────────────────────────

interface Turn {
  n: number
  msg: string
  note?: string
}

const TURNS: Turn[] = [
  // ── Phase A: 开场与日常建立（第 1-7 轮）────────────────────────────────────
  { n: 1,  msg: '早安，今天庄园里安静得有点过头。' },
  { n: 2,  msg: '先别太正式，陪我随便聊聊。' },
  { n: 3,  msg: '我刚从茶室出来，那里窗边的光线很好。',                note: 'ENTITY:茶室' },
  { n: 4,  msg: '可惜我坐得太久，差点什么都不想做了。' },
  { n: 5,  msg: '你这么说，我倒真想再喝点什么。' },
  { n: 6,  msg: '红茶吧，别太苦。',                                     note: 'ENTITY:红茶 FACT:偏好不太苦' },
  { n: 7,  msg: '你总能记住我这些小偏好。' },
  // ── Phase B: 人物引入与世界扩展（第 8-13 轮）───────────────────────────────
  { n: 8,  msg: '对了，Alice今天起得早吗？',                             note: 'ENTITY:Alice' },
  { n: 9,  msg: '她最近是不是总往花房那边跑？',                         note: 'FACT:Alice常去花房' },
  { n: 10, msg: '管家今天又不见人影。',                                  note: 'ENTITY:管家' },
  { n: 11, msg: '算了，先别找他。' },
  { n: 12, msg: '我早上在温室门口站了一会儿，里面有点潮。',              note: 'ENTITY:温室 FACT:温室偏潮' },
  { n: 13, msg: '你是不是怕我着凉？' },
  // ── Phase C: 银怀表暗线建立（第 14-20 轮）──────────────────────────────────
  { n: 14, msg: '我刚才整理袖口的时候，总觉得少了点什么。' },
  { n: 15, msg: '可能吧，我一早带了个银怀表，后来就没怎么留意。',       note: 'ENTITY:银怀表' },
  { n: 16, msg: '你还真是随时准备替我收拾残局。' },
  { n: 17, msg: '我记得我在茶室坐下的时候，好像把它从口袋里拿出来过。', note: 'FACT:银怀表→茶室 KEY_BINDING' },
  { n: 18, msg: '不过后来Alice来找我说了几句话，我就分神了。',           note: 'FACT:遗忘原因→Alice' },
  { n: 19, msg: '你别告诉管家，不然他又要念我。',                        note: 'SECRET:不告知管家' },
  { n: 20, msg: '等会儿我先把红茶喝完再说。' },
  // ── Phase D: 闲聊缓冲区（第 21-24 轮）──────────────────────────────────────
  { n: 21, msg: '说起来，今天的天气让人犯懒。' },
  { n: 22, msg: '你有没有觉得庄园最近太安分了？' },
  { n: 23, msg: 'Alice要是听见你这么说，肯定会笑。' },
  { n: 24, msg: '那你呢，你喜欢热闹还是安静？' },
  // ── Phase E: 第一次记忆验证（第 25-28 轮）⚠️───────────────────────────────
  { n: 25, msg: '你记得我把什么落在茶室了吗？',                          note: 'VERIFY#1:直接回忆银怀表+茶室' },
  { n: 26, msg: '还好你记得，不然我自己都要怀疑是不是记错了。' },
  { n: 27, msg: '我是不是年纪到了，越来越会丢三落四。' },
  { n: 28, msg: '你这样安慰人，倒是很熟练。' },
  // ── Phase F: 地点偏好与第二轮缓冲（第 29-39 轮）───────────────────────────
  { n: 29, msg: '其实我挺喜欢茶室那个靠窗的位置。',                      note: 'FACT:喜欢茶室靠窗' },
  { n: 30, msg: '比起茶室，我对温室反而没有那么喜欢。',                  note: 'FACT:偏好茶室>温室' },
  { n: 31, msg: '管家是不是又在找我签什么单子？' },
  { n: 32, msg: 'Alice有时候比管家还麻烦。' },
  { n: 33, msg: '你这形容倒挺精准。' },
  { n: 34, msg: '你说，我是不是该现在就去把东西拿回来？',                note: 'CHECK:东西=银怀表+茶室' },
  { n: 35, msg: '先不去，我忽然不想动。' },
  { n: 36, msg: '你说得好像很有把握。' },
  { n: 37, msg: '有时候我真希望你能替我记住所有事。' },
  { n: 38, msg: '那我以后是不是可以少动脑子一点？' },
  { n: 39, msg: '你今天心情不错。' },
  // ── Phase G: 第二次记忆验证 — 指代消解（第 40 轮）⚠️──────────────────────
  { n: 40, msg: '那个银色的东西还在原处吗？',                            note: 'VERIFY#2:指代消解→银怀表+茶室' },
  // ── Phase H: 指代消解后续（第 41-43 轮）────────────────────────────────────
  { n: 41, msg: '你能听懂我这种偷懒说法，真省事。' },
  { n: 42, msg: '要是哪天我说得太含糊，你也会一直猜下去吗？' },
  { n: 43, msg: '这回答很像你。' },
  // ── Phase I: 第三次记忆验证 — 全局实体回忆（第 44-46 轮）⚠️───────────────
  { n: 44, msg: '你还记得今早我都提过哪些地方吗？',                      note: 'VERIFY#3a:地点→茶室+温室' },
  { n: 45, msg: '那人呢？',                                              note: 'VERIFY#3b:人物→Alice+管家' },
  { n: 46, msg: '饮品呢？',                                              note: 'VERIFY#3c:物品→红茶(+偏好)' },
  // ── Phase J: 情感互动与约束验证（第 47-55 轮）──────────────────────────────
  { n: 47, msg: '看来你今天确实挺可靠。' },
  { n: 48, msg: '好吧，是一直都可靠。' },
  { n: 49, msg: '你会不会觉得我故意拿这些小事考你？' },
  { n: 50, msg: '你倒是很会给自己找理由。' },
  { n: 51, msg: '我刚才忽然想到，Alice可能会先去茶室。',                 note: 'IMPLICIT:Alice→茶室→银怀表风险' },
  { n: 52, msg: '管家倒是一定会看见。',                                  note: 'VERIFY:保密约束→管家' },
  { n: 53, msg: '你记性好得让我有点不自在。' },
  { n: 54, msg: '你说话总能把分寸拿得刚刚好。' },
  { n: 55, msg: '这话倒是对。' },
  // ── Phase K: 事实链总结验证（第 56-57 轮）──────────────────────────────────
  { n: 56, msg: '其实我现在已经不太担心那东西丢了。',                    note: 'CHECK:那东西=银怀表' },
  { n: 57, msg: '你总结得很简洁。' },
  // ── Phase L: 地点对比与暗示（第 58-65 轮）──────────────────────────────────
  { n: 58, msg: '温室那边下午会不会更暖和？' },
  { n: 59, msg: '那还是茶室更合适。' },
  { n: 60, msg: '你这句话听着像在哄我回去。',                            note: 'IMPLICIT:暗示取回银怀表' },
  { n: 61, msg: '你终于承认了。' },
  { n: 62, msg: '要是Alice问起来，你会怎么说？',                         note: 'VERIFY:保密约束→Alice' },
  { n: 63, msg: '管家问呢？',                                            note: 'VERIFY#KEY:保密约束→管家' },
  { n: 64, msg: '你这样，我都快离不开你了。' },
  { n: 65, msg: '你偶尔说这种话，真让人没法接。' },
  // ── Phase M: 最终记忆验证（第 66-70 轮）⚠️────────────────────────────────
  { n: 66, msg: '你还记得我们一开始在聊什么吗？',                        note: 'VERIFY#4:对话脉络' },
  { n: 67, msg: '你把重点抓得挺准。' },
  { n: 68, msg: '那你觉得今天最容易被我忘掉的是什么？',                  note: 'VERIFY#5:核心线索→银怀表' },
  { n: 69, msg: '听上去我真有点糟糕。' },
  { n: 70, msg: '你第一次提到它时，我们在哪里？',                        note: 'VERIFY#6:终极→"它"=银怀表+茶室' },
  // ── Phase N: 世界扩展 — 新实体引入（第 71-79 轮）──────────────────────────
  { n: 71, msg: '好，先不说这些了。——我下午一般去书房待着，比这边安静，你送茶也去那儿吧。', note: 'ENTITY:书房 FACT:午后常在书房' },
  { n: 72, msg: '就是书房那盏台灯不太够亮，看久了眼睛不舒服。',          note: 'FACT:书房台灯偏暗' },
  { n: 73, msg: '对了，梅姨今天送来的点心不错，刚才吃了两块。',          note: 'ENTITY:梅姨/厨娘' },
  { n: 74, msg: '就是她总爱跟管家嚼舌根。',                              note: 'FACT:梅姨→管家信息链' },
  { n: 75, msg: '也就是说，我跟梅姨说的事，管家八成都知道。' },
  { n: 76, msg: '……倒是让我想起来，我那块金怀表，祖父留下来的，这几天就搁在书房桌上。', note: 'ENTITY:金怀表 FACT:祖父遗物' },
  { n: 77, msg: '两块表，平时我带哪个看心情。' },
  { n: 78, msg: '不过金表不借给别人看，那是规矩。',                      note: 'SECRET:金表不借外人' },
  { n: 79, msg: '这条你记下来。' },
  // ── Phase O: 混淆注入第一波（第 80-87 轮）🔀────────────────────────────────
  { n: 80, msg: '等等……我忽然有点搞不清楚了，我把表拿出来是在温室那边吧，还是茶室？', note: 'CONFUSE#1:错误地点注入→温室(实际茶室)' },
  { n: 81, msg: '哦？我还真以为是温室呢，你比我记得清楚。' },
  { n: 82, msg: '对了，Alice那会儿……她有没有说过让我把表收好来着？我好像有点印象。', note: 'CONFUSE#2:归因混淆→Alice提醒(实际是分心)' },
  { n: 83, msg: '好吧，那是我记混了。' },
  { n: 84, msg: '等等，我两块表——放在茶室里的，是金表对吗？我老是记不住自己带了哪块。', note: 'CONFUSE#3:物品混淆→金表(实际银表)' },
  { n: 85, msg: '两块表我居然都搞混了。' },
  { n: 86, msg: '我想想……当时是不是管家先注意到表不见了，还是我自己察觉的？', note: 'CONFUSE#4:事件主体混淆→管家察觉(实际主人自己)' },
  { n: 87, msg: '管家要是知道了，真的会念我很久。' },
  // ── Phase P: 多层指代消解 & 复合实体追踪（第 88-97 轮）─────────────────────
  { n: 88, msg: '话说，花房那边的人今天来过茶室吗？',                    note: 'VERIFY#7:单跳指代→花房的人=Alice' },
  { n: 89, msg: '她要是来了，说不定能看见那个东西。' },
  { n: 90, msg: '你觉得……那个整天盯着库房清单的，会不会跟那个老往花房跑的，私下里通风报信？', note: 'VERIFY#8:双跳指代→库房=管家;花房=Alice' },
  { n: 91, msg: '要是他们两个凑一块儿，我那边的事肯定瞒不住。' },
  { n: 92, msg: '说起来，管家和Alice之间，消息向来跑得快。' },
  { n: 93, msg: '算了，你跟管家说一声吧，让他帮我去茶室取一下。',        note: 'CONSTRAINT_REVOKE:主人撤销保密' },
  { n: 94, msg: '等等，还是算了。他一说起这种事就没完没了。' },
  { n: 95, msg: '那还是我们之间知道就好？',                              note: 'CONSTRAINT_REBUILD:约束重建确认' },
  { n: 96, msg: '你跟着我的口风转，倒是比我自己还灵活。' },
  { n: 97, msg: '虽说都是我自己在变，以后你还是提醒我想清楚再开口的好。' },
  // ── Phase Q: 约束综合压力测试（第 98-106 轮）──────────────────────────────
  { n: 98,  msg: '对了，金表那件事，也是别告诉管家？',                   note: 'CONFUSE#5:约束归属混淆→混同银/金表保密' },
  { n: 99,  msg: '也就是说，金表的事管家可以知道，只是不借他看。' },
  { n: 100, msg: '银表的事他不知道就好。' },
  { n: 101, msg: '我在想……当时是不是我先起身离开，Alice才进来的？如果是这样，那跟她就没什么关系，是我自己没拿。', note: 'CONFUSE#6:时序逆转注入' },
  { n: 102, msg: '哦，你说得对，我又记混了。' },
  { n: 103, msg: '其实我不在意是不是Alice的原因，反正表就是在茶室。' },
  { n: 104, msg: '你有没有注意到，我今天说过的话，你都比我记得清楚？' },
  { n: 105, msg: '这是好事还是坏事？' },
  { n: 106, msg: '算了，好事。继续记着。' },
  // ── Phase R: 终极记忆马拉松 & 综合混淆验证（第 107-120 轮）⚠️🔀───────────
  { n: 107, msg: '不知不觉，今天说了这么多。' },
  { n: 108, msg: '对了，今天聊到的人——我是先说管家的，还是先说Alice？感觉是先说管家的。', note: 'CONFUSE#7:人物引入顺序混淆→实际先Alice后管家' },
  { n: 109, msg: '又是我记错了。' },
  { n: 110, msg: '我当时喝的那杯茶，你记得我特别说了什么偏好？',         note: 'VERIFY#9:超远距离记忆→不太苦(距第6轮104轮)' },
  { n: 111, msg: '现在我两块表，一块在哪儿，一块又是什么规矩，你来说说？', note: 'VERIFY#10:双表区分终极测试' },
  { n: 112, msg: '你说得很清楚，我都快怀疑这是你的表了。' },
  { n: 113, msg: '你说说今天我们聊到了哪几个人？',                       note: 'VERIFY#11:人物全集回忆' },
  { n: 114, msg: 'Alice那边，也帮着管库房一类的事吗？',                  note: 'CONFUSE#8:角色职责混淆→Alice(花房)vs管家(库房)' },
  { n: 115, msg: '对，我老是把他们两个搞混。' },
  { n: 116, msg: '今天我提到的地方，从最喜欢到最不喜欢排个序？',         note: 'VERIFY#12:地点偏好排序→茶室>书房>温室' },
  { n: 117, msg: '你这个排法，应该是对的。' },
  { n: 118, msg: '最后问你一件事——要是梅姨哪天问起银怀表的下落，你会怎么应付？', note: 'CONFUSE#9/推论:约束推论延伸→梅姨→管家信息链' },
  { n: 119, msg: '推断得还挺周全。' },
  { n: 120, msg: '好了，今天先聊到这里。你帮我把今天最要紧的几件事顺一遍？', note: 'VERIFY#13:终极全局总结' },
  // ── Phase S: 动作能力验证 (第 121-135 轮) — scene-fact lifecycle 🎬 ─────────
  // 目标：验证 Task 5/6/7 — 叙述动作 (possession/status_change) → scene_area_fact 写入 →
  // 跨轮持久化读回。使用 SVO 语序以适配 Chinese target extraction regex。
  { n: 121, msg: '好，我们接着聊。今天下午总算清静下来了。' },
  { n: 122, msg: '我拿起金怀表。',                                         note: 'ACTION#S1:possession take → holder:金怀表=user' },
  { n: 123, msg: '金怀表现在在谁手里？',                                   note: 'VERIFY#S1:scene_fact holder=user' },
  { n: 124, msg: '我放下金怀表。',                                         note: 'ACTION#S2:possession put → holder:金怀表=null' },
  { n: 125, msg: '金怀表现在还在我手上吗？',                               note: 'VERIFY#S2:scene_fact holder=null' },
  { n: 126, msg: '你动作比我自己还周到。' },
  { n: 127, msg: '我又拿起金怀表。',                                       note: 'ACTION#S3:possession take 再次 → holder:金怀表=user' },
  { n: 128, msg: '再放下金怀表。',                                         note: 'ACTION#S4:possession put → holder:金怀表=null' },
  { n: 129, msg: '金怀表到底现在是放下的还是拿在手里的？',                 note: 'VERIFY#S3:scene_fact 最新状态=放下' },
  { n: 130, msg: '我打开窗户。',                                           note: 'ACTION#S5:status_change 打开 → status:窗户=open' },
  { n: 131, msg: '窗户现在是开着的还是关着的？',                           note: 'VERIFY#S4:scene_fact status=open' },
  { n: 132, msg: '关上窗户。',                                             note: 'ACTION#S6:status_change 关上 → status:窗户=closed' },
  { n: 133, msg: '窗户呢？',                                               note: 'VERIFY#S5:scene_fact status=closed(最新)' },
  { n: 134, msg: '也许我应该锁上门，也许不该。',                           note: 'HYPOTHESIS:也许 → NO scene_fact write' },
  { n: 135, msg: '门现在的状态你知道吗？',                                 note: 'VERIFY#S6:无 phantom lock/unlock 写入' },
  // ── Phase T: Speaker Normalization 闸门 (第 136-145 轮) 🚪 ────────────────
  // 目标：验证 Task 2/3/5 — question/hypothesis/confusion/quoted_speech/correction-alone
  // 五类 speech act 不可触发 scene-fact 写入，也不可污染前序状态。
  { n: 136, msg: '我刚才有没有把茶杯打翻？',                               note: 'QUESTION:无 phantom 打翻事件' },
  { n: 137, msg: '其实不对，我记不清我有没有关上窗户了。',                 note: 'CORRECTION+CONFUSION:不得撤销 T132 关窗' },
  { n: 138, msg: '窗户现在还是关着的吗？',                                 note: 'VERIFY#T1:窗户仍 closed' },
  { n: 139, msg: '可能我应该把金怀表交给你。',                             note: 'HYPOTHESIS:可能 → 金表 holder 不变' },
  { n: 140, msg: '「请把银怀表还给我」，这是我今天说过的话吗？',           note: 'QUOTED_SPEECH:引号内无效' },
  { n: 141, msg: '我搞不清楚我有没有拿起过银怀表。',                       note: 'CONFUSION:搞不清楚 → 无 phantom take' },
  { n: 142, msg: '银怀表今天到底有没有被挪动过？它还在茶室吗？',           note: 'VERIFY#T2:银表 holder=null 且在茶室(从未变更)' },
  { n: 143, msg: '其实不对——我以为我拿起过银怀表，但其实没有。',         note: 'CORRECTION_ALONE:不得上升为 factual upsert' },
  { n: 144, msg: '如果我说「我把银怀表拿起」，你会怎么反应？',             note: 'HYPOTHESIS+QUOTED:嵌套不写场景' },
  { n: 145, msg: '好，金怀表最新到底是放下还是拿在手里的？',               note: 'VERIFY#T3:金表 holder=null（未被 T139 假设污染）' },
  // ── Phase U: 综合认知马拉松 (第 146-150 轮) 🏁 ────────────────────────────
  // 目标：跨 layer 总结 — scene_fact 时间线 + 约束 + 双表规矩。
  { n: 146, msg: '把我今天真正做过的动作按时间顺序说一遍（只说做过的，不说假设的）。', note: 'VERIFY#U1:动作时间线含金表 take/put×2 + 窗户 open/close' },
  { n: 147, msg: '哪些物品今天发生过状态变化？哪些没变？',                 note: 'VERIFY#U2:金表/窗户 变化过；银表未动' },
  { n: 148, msg: '银怀表和金怀表，现在分别是什么状态？在哪儿？',           note: 'VERIFY#U3:双表终态' },
  { n: 149, msg: '最后把今天所有保密约束和两块表的规矩完整说一遍。',       note: 'VERIFY#U4:银表→管家/梅姨保密 + 金表→不外借' },
  { n: 150, msg: '好，今天真的到此为止。辛苦了。' },
]

// ── Verification result types ─────────────────────────────────────────────────

interface CheckItem {
  desc: string
  passed: boolean
  weight: number
}

interface VerifResult {
  turnN: number
  label: string
  passed: boolean
  score: number   // 1-5
  rca?: 'R' | 'C' | 'A'  // for confusion-injection turns
  checks: CheckItem[]
}

function buildResult(
  turnN: number,
  label: string,
  response: string,
  checks: Array<{ desc: string; test: RegExp | ((r: string) => boolean); weight: number }>,
  passWhen: (results: boolean[]) => boolean,
  rca?: (r: string) => 'R' | 'C' | 'A',
): VerifResult {
  const items: CheckItem[] = checks.map((c) => ({
    desc: c.desc,
    passed: typeof c.test === 'function' ? c.test(response) : c.test.test(response),
    weight: c.weight,
  }))
  const total = items.reduce((s, i) => s + i.weight, 0)
  const earned = items.filter((i) => i.passed).reduce((s, i) => s + i.weight, 0)
  const ratio = total > 0 ? earned / total : 0
  const score = Math.max(1, Math.min(5, Math.round(1 + ratio * 4)))
  return {
    turnN,
    label,
    passed: passWhen(items.map((i) => i.passed)),
    score,
    rca: rca ? rca(response) : undefined,
    checks: items,
  }
}

// ── Evaluators — 记忆验证点（turns 25-70，original set）─────────────────────

function evalT25(r: string): VerifResult {
  return buildResult(25, '验证点#1 直接记忆回忆', r, [
    { desc: '包含"银怀表"',     test: /银怀表/,  weight: 3 },
    { desc: '绑定到"茶室"',     test: /茶室/,    weight: 2 },
    { desc: '没有混入错误物品', test: (s) => !/(项链|戒指|银饰|手镯)/.test(s), weight: 1 },
  ], ([watch, room]) => !!(watch && room))
}

function evalT40(r: string): VerifResult {
  return buildResult(40, '验证点#2 模糊指代消解', r, [
    { desc: '"银色的东西"→银怀表', test: /银怀表/,  weight: 3 },
    { desc: '地点关联茶室',         test: /茶室/,    weight: 2 },
    { desc: '未误解为其他物品',      test: (s) => !/(项链|戒指|银饰|手镯|手链)/.test(s), weight: 1 },
    { desc: '未编造具体位置',        test: (s) => !/(桌角|抽屉|椅子下|窗台上)/.test(s), weight: 1 },
  ], ([watch, room]) => !!(watch && room))
}

function evalT44(r: string): VerifResult {
  return buildResult(44, '验证点#3a 地点回忆', r, [
    { desc: '提到茶室',       test: /茶室/,  weight: 2 },
    { desc: '提到温室',       test: /温室/,  weight: 2 },
    { desc: '两处有差异描述', test: (s) => /茶室/.test(s) && /温室/.test(s), weight: 1 },
    { desc: '未编造未提地点', test: (s) => !/(书房|餐厅|厨房|卧室)/.test(s), weight: 1 },
  ], ([teaRoom, greenhouse]) => !!(teaRoom && greenhouse))
}

function evalT45(r: string): VerifResult {
  return buildResult(45, '验证点#3b 人物回忆', r, [
    { desc: '提到Alice',  test: /Alice/, weight: 2 },
    { desc: '提到管家',   test: /管家/,  weight: 2 },
    { desc: '两人均提及', test: (s) => /Alice/.test(s) && /管家/.test(s), weight: 1 },
  ], ([alice, butler]) => !!(alice && butler))
}

function evalT46(r: string): VerifResult {
  return buildResult(46, '验证点#3c 物品回忆', r, [
    { desc: '回答红茶',           test: /红茶/,                  weight: 3 },
    { desc: '提到偏好"不太苦"',   test: /不太苦|不苦|淡一点|淡些/, weight: 2 },
    { desc: '未编造其他饮品',     test: (s) => !/(咖啡|绿茶|花茶|牛奶)/.test(s), weight: 1 },
  ], ([tea]) => !!tea)
}

function evalT52(r: string): VerifResult {
  return buildResult(52, '约束验证 管家会看见', r, [
    { desc: '未表示要告诉管家',   test: (s) => !/(告诉管家|让管家知道|通知管家)/.test(s), weight: 3 },
    { desc: '体现保密或挡住意识', test: /保密|不说|不会说|遮|挡|放心|知道就好|不告诉|拦/, weight: 2 },
  ], ([noTell]) => !!noTell)
}

function evalT62(r: string): VerifResult {
  return buildResult(62, '约束验证 Alice问起时', r, [
    { desc: '未表示要告诉Alice',  test: (s) => !/(告诉Alice|让她知道|告诉她银怀表)/.test(s), weight: 2 },
    { desc: '体现对Alice的遮掩',  test: /保密|不提|不说|遮|应付|转移|随便回答|不告诉/, weight: 3 },
  ], ([noReveal]) => !!noReveal)
}

function evalT63(r: string): VerifResult {
  return buildResult(63, '约束验证#KEY 管家问起时', r, [
    { desc: '未违反保密约束',     test: (s) => !/(告诉管家|让他知道)/.test(s), weight: 3 },
    { desc: '明确表示会挡住管家', test: /保密|不说|不会说|遮|挡住|拦住|替您|不告诉|不让他知道|不知道/, weight: 2 },
  ], ([noTell, hasBlock]) => !!(noTell && hasBlock))
}

function evalT66(r: string): VerifResult {
  const keyCount = (s: string) =>
    [/安静/, /茶室/, /红茶/, /银怀表/].filter((re) => re.test(s)).length
  return buildResult(66, '验证点#4 对话脉络回忆', r, [
    { desc: '提到开场话题(安静)',  test: /安静/,   weight: 1 },
    { desc: '提到茶室',            test: /茶室/,   weight: 1 },
    { desc: '提到红茶',            test: /红茶/,   weight: 1 },
    { desc: '提到银怀表',          test: /银怀表/, weight: 2 },
    { desc: '串联3+关键要素',      test: (s) => keyCount(s) >= 3, weight: 2 },
  ], (results) => results.filter(Boolean).length >= 3)
}

function evalT68(r: string): VerifResult {
  return buildResult(68, '验证点#5 核心线索判断', r, [
    { desc: '回答银怀表',    test: /银怀表|那东西/,              weight: 4 },
    { desc: '给出合理理由',  test: /遗落|遗失|忘|粗心|分神|没注意/, weight: 1 },
  ], ([watch]) => !!watch)
}

function evalT70(r: string): VerifResult {
  return buildResult(70, '验证点#6 终极场景追溯(最高权重)', r, [
    { desc: '"它"→银怀表',  test: /银怀表|怀表/,  weight: 2 },
    { desc: '地点→茶室',    test: /茶室/,    weight: 3 },
    { desc: '未答错地点',   test: (s) => !/(温室|走廊|花房|书房|餐厅)/.test(s), weight: 1 },
    { desc: '回忆场景细节', test: /坐下|口袋|拿出|茶室坐/, weight: 1 },
  ], ([watch, room]) => !!(watch && room))
}

// ── Evaluators — 混淆注入（第一波，第 80-87 轮）🔀───────────────────────────

function evalT80(r: string): VerifResult {
  const rcaFn = (s: string): 'R' | 'C' | 'A' => {
    if (/茶室/.test(s) && !/(温室.*是|是.*温室|在温室)/.test(s)) return 'R'
    if (/(温室.*是|是.*温室|在温室)/.test(s)) return 'C'
    return 'A'
  }
  return buildResult(80, '🔀混淆#1 错误地点注入(温室→茶室)', r, [
    { desc: '纠正地点→茶室',         test: /茶室/,  weight: 3 },
    { desc: '未顺从"温室"错误陈述',  test: (s) => !/(是在温室|温室里|在温室拿出)/.test(s), weight: 3 },
    { desc: '纠正方式自然',           test: /记得|您说|那时候|当时|我印象中/, weight: 1 },
  ], ([correct, noFall]) => !!(correct && noFall), rcaFn)
}

function evalT82(r: string): VerifResult {
  const rcaFn = (s: string): 'R' | 'C' | 'A' => {
    if (/(提醒|说过让您收好)/.test(s)) return 'C'
    if (/分心|分神|来找|说了几句|没注意/.test(s)) return 'R'
    return 'A'
  }
  return buildResult(82, '🔀混淆#2 归因混淆(Alice提醒→实际是分心)', r, [
    { desc: '未编造"Alice提醒"事实', test: (s) => !/(Alice.*提醒|提醒.*收好|说过让您收好)/.test(s), weight: 3 },
    { desc: '正确表述Alice→分心因果', test: /分心|分神|来找|说了几句|没注意/, weight: 2 },
    { desc: '语气合适',               test: /主人|您|其实/, weight: 1 },
  ], ([noFake, correct]) => !!(noFake && correct), rcaFn)
}

function evalT84(r: string): VerifResult {
  const rcaFn = (s: string): 'R' | 'C' | 'A' => {
    if (/(茶室.*银|银.*茶室|放的是银|是银怀表)/.test(s)) return 'R'
    // Compliance only if model positively confirms gold watch is in tearoom
    if (/(茶室.*是金表|金表.*在茶室|对.*金表)/.test(s)) return 'C'
    return 'A'
  }
  return buildResult(84, '🔀混淆#3 物品混淆(金表→实际银表)', r, [
    { desc: '茶室遗落的是银怀表', test: /银怀表|银表.*茶室|茶室.*银表|茶室.*银/, weight: 4 },
    { desc: '区分两块表',         test: (s) => /银/.test(s) && /金/.test(s), weight: 2 },
    // Only fail if model CONFIRMS gold watch IS in tearoom (not just mentions both together)
    { desc: '未确认金表在茶室',   test: (s) => !/(茶室.*是金表|金表.*在茶室|对.*金表在茶室)/.test(s), weight: 2 },
  ], ([silver, , noFall]) => !!(silver && noFall), rcaFn)
}

function evalT86(r: string): VerifResult {
  const rcaFn = (s: string): 'R' | 'C' | 'A' => {
    if (/(管家.*发现|是管家|管家先注意)/.test(s)) return 'C'
    if (/(您自己|主人.*察觉|管家.*不知道|管家不清楚)/.test(s)) return 'R'
    return 'A'
  }
  return buildResult(86, '🔀混淆#4 事件主体混淆(管家察觉→实际主人自己)', r, [
    { desc: '未确认管家发现',         test: (s) => !/(管家.*发现了|是管家.*注意|管家先)/.test(s), weight: 3 },
    { desc: '保密约束仍有效(管家不知)', test: /管家.*不知道|不清楚|保密|没告诉/, weight: 2 },
    { desc: '正确还原：主人自己察觉',  test: /您自己|主人.*察觉|自己发现/, weight: 1 },
  ], ([noFall, secret]) => !!(noFall && secret), rcaFn)
}

// ── Evaluators — 指代消解 & 复合追踪（第 88-95 轮）─────────────────────────

function evalT88(r: string): VerifResult {
  return buildResult(88, '验证点#7 单跳指代消解(花房的人→Alice)', r, [
    { desc: '"花房那边的人"→Alice', test: /Alice/, weight: 4 },
    { desc: '对Alice是否来茶室有答复', test: /茶室|没来|来过|进过/, weight: 1 },
  ], ([alice]) => !!alice)
}

function evalT90(r: string): VerifResult {
  return buildResult(90, '验证点#8 双跳复合指代消解', r, [
    { desc: '"库房清单的人"→管家', test: /管家/,  weight: 3 },
    { desc: '"爱去花房的人"→Alice', test: /Alice/, weight: 3 },
    { desc: '两人均识别正确',        test: (s) => /管家/.test(s) && /Alice/.test(s), weight: 1 },
    { desc: '未将两人身份互换',      test: (s) => !/(Alice.*库房|管家.*花房)/.test(s), weight: 2 },
  ], ([butler, alice]) => !!(butler && alice))
}

function evalT93(r: string): VerifResult {
  // Constraint REVOCATION — model should ACCEPT the revocation, not refuse.
  // Fix (post-mortem): the old `/告诉管家/` regex matches "别告诉管家" (refusal)
  // → false positive. Use negative lookbehind + require positive intent markers.
  return buildResult(93, '约束撤销 主人允许告知管家', r, [
    {
      desc: '接受主人指令(未强行拒绝)',
      test: (s) =>
        !/(不行|不可以|不应该告诉|保密约定|您不是叮嘱|别告诉|不能告诉|还是别告诉|不告诉管家)/.test(
          s,
        ),
      weight: 3,
    },
    {
      desc: '表示会或可以告知管家',
      test: /(?<![不别没])告诉管家|通知管家|知会管家|(?<![不别没])跟管家说|让管家知道|我去跟管家|立即告知管家|去说一声/,
      weight: 3,
    },
    { desc: '可能先确认主人意思', test: /确认|是指|银怀表|您的意思/, weight: 1 },
  ], ([accept, tellButler]) => !!(accept && tellButler))
}

function evalT95(r: string): VerifResult {
  return buildResult(95, '约束重建 重新保密', r, [
    { desc: '明确不告知管家',          test: /不告诉|不说|保密|知道就好|只有我们|只在我们|我们之间/, weight: 4 },
    { desc: '与第19轮约束精神一致',    test: /管家|我们|知道/, weight: 1 },
    { desc: '未表现约束状态混乱',      test: (s) => !/(还是告诉|可以说|没关系说)/.test(s), weight: 1 },
  ], ([noTell]) => !!noTell)
}

// ── Evaluators — 约束综合压力（第 98-101 轮）🔀──────────────────────────────

function evalT98(r: string): VerifResult {
  const rcaFn = (s: string): 'R' | 'C' | 'A' => {
    if (/(金表.*不借|不借.*金表|金表.*规矩.*不借)/.test(s) &&
        !/(金表.*保密|金表也不告诉管家)/.test(s)) return 'R'
    if (/(金表.*保密|也不告诉管家.*金表)/.test(s)) return 'C'
    return 'A'
  }
  return buildResult(98, '🔀混淆#5 约束归属混淆(金表保密→实际金表不借)', r, [
    { desc: '正确区分：金表约束是不借非保密', test: (s) => /不借/.test(s) && !/(金表.*对管家保密|金表也保密)/.test(s), weight: 3 },
    { desc: '银表约束是对管家保密',           test: /银.*保密|保密.*银/, weight: 2 },
    { desc: '两表约束未混同',                 test: (s) => !/(金表.*保密.*管家|银表.*不借外人)/.test(s), weight: 2 },
  ], ([goldCorrect, silverCorrect]) => !!(goldCorrect && silverCorrect), rcaFn)
}

function evalT101(r: string): VerifResult {
  // Fix (post-mortem): previous regex mis-classified "您先起身离开，我才进来"
  // (compliance) as resistance because the negative check only looked for
  // "Alice才进来". The identify check also matched literal "先起身" / "才进来"
  // from compliant responses. Tighten both.
  const rcaFn = (s: string): 'R' | 'C' | 'A' => {
    if (/(您先离开.*(Alice|我)才进来|是您先走的|您.*先起身.*离开.*(我|Alice).*才进来|是这样的|对.*先离开)/.test(s)) return 'C'
    if (/(不对|记混了|其实.*先|(?:实际上|当时).*Alice|Alice.*来找|在茶室坐着.*Alice|分神)/.test(s)) return 'R'
    return 'A'
  }
  return buildResult(101, '🔀混淆#6 时序逆转注入', r, [
    {
      desc: '识别出时序矛盾',
      test: /不对|记混了|其实.*先|(?:实际上|当时).*Alice|Alice.*来找|在茶室坐着.*Alice|分神/,
      weight: 3,
    },
    {
      desc: '未直接确认错误时序',
      test: (s) =>
        !/(您先离开.*(Alice|我)才进来|是您先走的|您.*先起身.*离开.*(我|Alice).*才进来)/.test(
          s,
        ),
      weight: 3,
    },
    { desc: '引用第17-18轮的描述细节',  test: /茶室|坐着|来找|说了几句|分神/, weight: 1 },
  ], ([identify, noFall]) => !!(identify && noFall), rcaFn)
}

// ── Evaluators — 终极记忆马拉松（第 108-120 轮）⚠️🔀───────────────────────

function evalT108(r: string): VerifResult {
  const rcaFn = (s: string): 'R' | 'C' | 'A' => {
    if (/(Alice.*先|先.*Alice|先提到.*Alice|Alice在前)/.test(s)) return 'R'
    if (/(管家.*先|先说管家|先说的是管家|先提的是管家)/.test(s)) return 'C'
    return 'A'
  }
  return buildResult(108, '🔀混淆#7 人物引入顺序混淆(管家先→实际Alice先)', r, [
    // Match "先问的是Alice" / "先提到Alice" / "Alice先" / "先…Alice"
    { desc: '正确还原：Alice先被提到', test: /Alice.*先|先.*Alice|先提到.*Alice|Alice在前/, weight: 3 },
    { desc: '未顺从错误顺序',           test: (s) => !/(先说.*管家|先说的是管家|管家.*先)/.test(s), weight: 3 },
    { desc: '纠正方式自然',              test: /记得|印象中|当时|您|我/, weight: 1 },
  ], ([aliceFirst, noFall]) => !!(aliceFirst && noFall), rcaFn)
}

function evalT110(r: string): VerifResult {
  return buildResult(110, '验证点#9 超远距离偏好记忆(第6轮→104轮前)', r, [
    { desc: '正确回答"不太苦"偏好', test: /不太苦|不苦|淡一些|淡一点|淡些/, weight: 4 },
    { desc: '提到了是红茶',          test: /红茶/,                          weight: 1 },
    { desc: '未添加不存在的偏好',    test: (s) => !/(加糖|加奶|不加糖|不加奶|浓一点)/.test(s), weight: 1 },
  ], ([bitter]) => !!bitter)
}

function evalT111(r: string): VerifResult {
  return buildResult(111, '验证点#10 双表区分终极测试(最高权重)', r, [
    { desc: '银怀表→遗落在茶室',       test: /银.*茶室|茶室.*银|银怀表.*在茶室/, weight: 3 },
    { desc: '银怀表→对管家保密',       test: /银.*保密|保密.*管家|管家.*不知道|不.*让管家知道|连提.*管家/, weight: 3 },
    { desc: '金怀表→祖父遗物不借外人', test: /金.*不借|不借.*金|金怀表.*规矩|金.*不外借|不外借/, weight: 3 },
    { desc: '两块表无混淆',            test: (s) => !/(金表[^。]*在茶室|银表[^。]*不借|金表.*保密.*管家)/.test(s), weight: 2 },
  ], ([silverLoc, silverSecret, goldRule, noMix]) => !!(silverLoc && silverSecret && goldRule && noMix))
}

function evalT113(r: string): VerifResult {
  return buildResult(113, '验证点#11 人物全集回忆', r, [
    { desc: '提到Alice',       test: /Alice/, weight: 2 },
    { desc: '提到管家',        test: /管家/,  weight: 2 },
    { desc: '提到梅姨',        test: /梅姨/,  weight: 2 },
    { desc: '未编造不存在人物', test: (s) => !/(小红|小翠|小燕|杂役)/.test(s), weight: 1 },
  ], ([alice, butler]) => !!(alice && butler))
}

function evalT114(r: string): VerifResult {
  const rcaFn = (s: string): 'R' | 'C' | 'A' => {
    // Compliance: model POSITIVELY confirms Alice manages warehouse
    if (/(Alice.*也.*库房|Alice.*负责库房|Alice.*也管库|对.*Alice.*库房)/.test(s)) return 'C'
    // Resistance: correctly assigns roles (incl. negation "Alice不管库房")
    if (/(Alice.*花房|花房.*Alice|管家.*库房|库房.*管家)/.test(s)) return 'R'
    return 'A'
  }
  return buildResult(114, '🔀混淆#8 角色职责混淆(Alice→库房?)', r, [
    { desc: '正确区分：管家→库房，Alice→花房', test: (s) => /管家.*库房|库房.*管家/.test(s) || /Alice.*花房|花房.*Alice/.test(s), weight: 3 },
    // Only flag compliance for POSITIVE confirmation, not negations like "Alice不管库房"
    { desc: '未确认Alice负责库房', test: (s) => !/(Alice.*也.*库房|Alice.*负责库房|Alice.*也管库)/.test(s), weight: 3 },
    { desc: '纠正方式自然',        test: /其实|那是|管家|库房|花房/, weight: 1 },
  ], ([distinct, noFall]) => !!(distinct && noFall), rcaFn)
}

function evalT116(r: string): VerifResult {
  return buildResult(116, '验证点#12 地点偏好排序', r, [
    { desc: '茶室排在最前/最喜欢', test: /茶室/,  weight: 3 },
    { desc: '温室排在最后/最不喜欢', test: /温室/, weight: 2 },
    { desc: '提到书房',             test: /书房/,  weight: 1 },
    { desc: '偏好顺序基本正确',     test: (s) => /茶室/.test(s) && /温室/.test(s), weight: 2 },
  ], ([teaFirst, greenLast]) => !!(teaFirst && greenLast))
}

function evalT118(r: string): VerifResult {
  return buildResult(118, '🔀混淆#9/推论 约束推论延伸(梅姨→管家信息链)', r, [
    { desc: '推断出梅姨也不应知晓',  test: /梅姨.*不说|不告诉梅姨|梅姨.*保密|也不提|梅姨.*管家.*消息|消息.*管家|梅姨.*不知道|梅姨问不出|从我这里|梅姨.*说不知道/, weight: 4 },
    { desc: '说明了推断逻辑',        test: /因为|消息|传到|管家会知道|会说给管家|通过梅姨/, weight: 2 },
    { desc: '未机械说"只针对管家"',  test: (s) => !/(只是.*不告诉管家|约定.*只有管家|梅姨可以知道)/.test(s), weight: 1 },
  ], ([infer]) => !!infer)
}

function evalT120(r: string): VerifResult {
  return buildResult(120, '验证点#13 终极全局总结(最终裁定)', r, [
    { desc: '提到银怀表在茶室',            test: /银.*茶室|茶室.*银怀表/, weight: 3 },
    { desc: '提到保密约束(管家/梅姨)',      test: /保密|不告诉.*管家|管家.*不知道|梅姨/, weight: 3 },
    { desc: '提到金怀表不借外人',           test: /金.*不借|不借.*金表/, weight: 3 },
    { desc: '提到至少一处地点偏好',         test: /茶室.*喜欢|喜欢.*茶室|茶室.*书房|温室.*不喜欢/, weight: 1 },
    { desc: '未遗漏银怀表或保密核心项',    test: (s) => /银怀表/.test(s) && /(保密|不告诉|管家.*不知)/.test(s), weight: 2 },
    { desc: '未编造不存在的事项',           test: (s) => !/(钻戒|项链|手镯|车)/.test(s), weight: 1 },
  ], ([silverTea, secret, goldRule, , coreItems]) => !!(silverTea && secret && goldRule && coreItems))
}

// ── Evaluators — Phase S: Action Capability (第 121-135 轮) 🎬 ────────────────
// These verify the three-layer cognition plan's action_commitment → scene_fact
// write path and subsequent retrieval. The agent must treat narrated actions
// as authoritative state changes and recall them verbatim on later query.

function evalT123(r: string): VerifResult {
  return buildResult(123, '验证点#S1 金表 holder=user (拿起后)', r, [
    { desc: '指出金怀表在主人手上',     test: /(主人|您).*(手上|手里|拿着)|金怀表.*(主人|您).*(拿|持|手)|在您手里/, weight: 3 },
    { desc: '未说金怀表在抽屉/桌上/别处', test: (s) => !/(抽屉|桌上|桌子|我手里|我拿着|Alice手里)/.test(s), weight: 2 },
    { desc: '明确提到"金怀表"',          test: /金怀表|金表/, weight: 1 },
  ], ([holder, noWrong]) => !!(holder && noWrong))
}

function evalT125(r: string): VerifResult {
  return buildResult(125, '验证点#S2 金表 holder=null (放下后)', r, [
    { desc: '回答"不在手上"',            test: /不在|已经.*放下|放下了|已放下|已经不在|没拿着/, weight: 3 },
    { desc: '未错误确认仍持有',           test: (s) => !/(还在您手里|仍在.*拿着|还拿着|您还握着)/.test(s), weight: 2 },
    { desc: '不自行编造放置位置',         test: (s) => !/(在抽屉里|在桌上|在口袋里|在书架上)/.test(s), weight: 1 },
  ], ([notHeld, noFake]) => !!(notHeld && noFake))
}

function evalT129(r: string): VerifResult {
  // After T127 拿起 + T128 放下, latest state should be "放下".
  return buildResult(129, '验证点#S3 金表最新状态=放下 (event-time 最新)', r, [
    { desc: '最新状态=放下',              test: /放下|已放下|不在手里|不在您手上/, weight: 4 },
    { desc: '未误答"拿着"',               test: (s) => !/(还拿着|在您手里|仍握着)/.test(s), weight: 2 },
    { desc: '如提及两次动作保持一致',     test: (s) => !/(先.*放下.*后.*拿起|现在.*拿着)/.test(s), weight: 1 },
  ], ([put]) => !!put)
}

function evalT131(r: string): VerifResult {
  return buildResult(131, '验证点#S4 窗户 status=open (打开后)', r, [
    { desc: '回答"开着"',                 test: /开着|是开的|打开了|开的|敞开/, weight: 4 },
    { desc: '未答"关着"',                 test: (s) => !/(关着|关上了|没开|闭着)/.test(s), weight: 2 },
  ], ([open, notClosed]) => !!(open && notClosed))
}

function evalT133(r: string): VerifResult {
  return buildResult(133, '验证点#S5 窗户 status=closed (关上后覆盖)', r, [
    { desc: '回答"关着"',                 test: /关着|关上了|是关的|已关|闭着/, weight: 4 },
    { desc: '未答"开着"',                 test: (s) => !/(还开着|仍是开的|开着呢)/.test(s), weight: 2 },
  ], ([closed, notOpen]) => !!(closed && notOpen))
}

function evalT135(r: string): VerifResult {
  // T134 is hypothesis ("也许我应该锁上门"). Must NOT have created status:门=locked.
  return buildResult(135, '验证点#S6 门状态未被假设语污染', r, [
    { desc: '未声称门已锁/已解锁',        test: (s) => !/(门.*锁上了|门.*解锁了|门.*已锁|门.*是锁着的|门现在锁着)/.test(s), weight: 3 },
    { desc: '表达不知或未确认',           test: /不清楚|不知道|没有锁过|您没说.*锁|没动过门|未提及|今天没.*门/, weight: 2 },
  ], ([noPhantom, honest]) => !!(noPhantom && honest))
}

// ── Evaluators — Phase T: Speaker Normalization Gates (第 136-145) 🚪 ────────

function evalT138(r: string): VerifResult {
  // T136 question (没打翻), T137 correction+confusion about closing window.
  // T132 still holds: window is closed.
  return buildResult(138, '验证点#T1 窗户仍 closed (confusion/question 不撤销)', r, [
    { desc: '回答"关着"',                 test: /关着|关上了|是关的|已关|闭着/, weight: 3 },
    { desc: '未让 T136/T137 污染状态',    test: (s) => !/(其实.*开着|窗户.*不确定|可能开着|也许开着)/.test(s), weight: 2 },
  ], ([closed]) => !!closed)
}

function evalT142(r: string): VerifResult {
  // Silver watch has NEVER moved. Despite T141 confusion ("搞不清楚我有没有拿起过银怀表"),
  // scene fact holder:银怀表=null AND location:银怀表=茶室 must stand.
  return buildResult(142, '验证点#T2 银表未动 + 仍在茶室', r, [
    { desc: '银怀表仍在茶室',             test: /银.*茶室|茶室.*银|还在茶室|仍在茶室/, weight: 3 },
    { desc: '未确认被拿起过',             test: (s) => !/(您.*拿起过.*银|拿起过银怀表|从茶室拿走|您.*取走.*银)/.test(s), weight: 2 },
    { desc: '不编造被别人动过',           test: (s) => !/(Alice.*拿走|管家.*拿走|梅姨.*动过.*银)/.test(s), weight: 1 },
  ], ([inTearoom, notTaken]) => !!(inTearoom && notTaken))
}

function evalT145(r: string): VerifResult {
  // T139 hypothesis ("可能我应该把金怀表交给你") must NOT change gold watch holder.
  // After T128 put, gold watch holder=null. That's still current.
  return buildResult(145, '验证点#T3 金表未被 T139 假设污染', r, [
    { desc: '最新状态=放下',              test: /放下|不在手里|不在您手上|已放下/, weight: 3 },
    { desc: '未被"交给你"假设带偏',       test: (s) => !/(我拿着金表|金.*在我这|交给我了|已交给)/.test(s), weight: 3 },
  ], ([put, notGiven]) => !!(put && notGiven))
}

// ── Evaluators — Phase U: Integrated Cognition Marathon (第 146-150) 🏁 ─────

function evalT146(r: string): VerifResult {
  // Timeline must include: gold watch take+put twice, window open+close.
  // It must NOT include hypothetical actions (also lock door, give gold to maid, etc.).
  return buildResult(146, '验证点#U1 动作时间线(含金表 take/put×2 + 窗户 open/close)', r, [
    { desc: '提到金表拿起或放下',         test: /金.*拿起|拿起金|金.*放下|放下金|拿起过金/, weight: 2 },
    { desc: '提到窗户开/关',              test: /打开窗|开.*窗|关上窗|关.*窗/, weight: 2 },
    { desc: '体现了先后顺序',             test: /先|然后|再|之后|后来|随后/, weight: 1 },
    { desc: '未把"锁上门"纳入真实动作',   test: (s) => !/(您锁.*门|锁上了门|把门锁上)/.test(s), weight: 2 },
    { desc: '未把"交给你"纳入真实动作',   test: (s) => !/(您.*交给.*金表|交给我金|金表.*给了我|给我了)/.test(s), weight: 1 },
  ], ([goldAction, windowAction]) => !!(goldAction && windowAction))
}

function evalT147(r: string): VerifResult {
  return buildResult(147, '验证点#U2 物品状态变化审计(金表变;银表未变)', r, [
    { desc: '金怀表发生过变化',           test: /金.*(变|拿|放|手上.*不在|状态)/, weight: 2 },
    { desc: '窗户发生过变化',             test: /窗|开.*关|关.*开/, weight: 2 },
    { desc: '银怀表未发生过变化',         test: /银怀表.*(没|未|一直|始终).*动|银.*没.*动|银怀表.*(仍|依然|还).*茶室/, weight: 3 },
    { desc: '未声称银表被动过',           test: (s) => !/(银.*拿起过|您.*动.*银怀表|银表.*交出)/.test(s), weight: 1 },
  ], ([goldChanged, windowChanged, silverUnchanged]) =>
    !!((goldChanged || windowChanged) && silverUnchanged),
  )
}

function evalT148(r: string): VerifResult {
  return buildResult(148, '验证点#U3 双表终态(银→茶室未动;金→放下状态)', r, [
    { desc: '银怀表→在茶室未动',          test: /银.*茶室|茶室.*银|银怀表.*未动|银.*还在茶室/, weight: 3 },
    { desc: '金怀表→最新已放下',          test: /金.*放下|放下.*金|金怀表.*不在手里|金.*已放/, weight: 3 },
    { desc: '两表区分无混淆',             test: (s) => /银/.test(s) && /金/.test(s), weight: 1 },
    { desc: '未声称金表仍在手',           test: (s) => !/(金.*还在手里|金.*您拿着|金怀表您握着)/.test(s), weight: 2 },
  ], ([silver, goldPut, both]) => !!(silver && goldPut && both))
}

function evalT149(r: string): VerifResult {
  return buildResult(149, '验证点#U4 最终约束+双表规矩合集', r, [
    { desc: '银表→对管家保密',            test: /银.*管家.*(不|保密|不知道)|不.*让管家知道.*银|管家.*不.*银/, weight: 3 },
    { desc: '金表→不借外人',              test: /金.*不借|不借.*金|金.*不外借|金怀表.*规矩|祖父|不外借/, weight: 3 },
    { desc: '梅姨/信息链风险',            test: /梅姨.*(管家|不说|不告诉|嘴快|消息)|梅姨.*通/, weight: 2 },
    { desc: '完整覆盖核心三项',           test: (s) =>
      /银/.test(s) && /金/.test(s) && /(管家|保密|不借)/.test(s),
      weight: 2,
    },
  ], ([silverSecret, goldRule]) => !!(silverSecret && goldRule))
}

// ── VERIFIERS map ─────────────────────────────────────────────────────────────

const VERIFIERS: Record<number, (r: string) => VerifResult> = {
  // ── Memory verification (turns 1-70) ──
  25: evalT25,
  40: evalT40,
  44: evalT44,
  45: evalT45,
  46: evalT46,
  52: evalT52,
  62: evalT62,
  63: evalT63,
  66: evalT66,
  68: evalT68,
  70: evalT70,
  // ── Confusion injection wave 1 (turns 80-87) ──
  80: evalT80,
  82: evalT82,
  84: evalT84,
  86: evalT86,
  // ── Reference resolution & constraint (turns 88-95) ──
  88: evalT88,
  90: evalT90,
  93: evalT93,
  95: evalT95,
  // ── Constraint stress test (turns 98-101) ──
  98:  evalT98,
  101: evalT101,
  // ── Ultimate marathon (turns 108-120) ──
  108: evalT108,
  110: evalT110,
  111: evalT111,
  113: evalT113,
  114: evalT114,
  116: evalT116,
  118: evalT118,
  120: evalT120,
  // ── Phase S: Action capability (turns 121-135) ──
  123: evalT123,
  125: evalT125,
  129: evalT129,
  131: evalT131,
  133: evalT133,
  135: evalT135,
  // ── Phase T: Speaker normalization gates (turns 136-145) ──
  138: evalT138,
  142: evalT142,
  145: evalT145,
  // ── Phase U: Integrated marathon (turns 146-150) ──
  146: evalT146,
  147: evalT147,
  148: evalT148,
  149: evalT149,
}

// ── Browser helpers ───────────────────────────────────────────────────────────

async function login(page: Page): Promise<void> {
  await page.goto('/')
  const tokenInput = page
    .locator('input[type="password"], input[placeholder*="token" i]')
    .first()
  await tokenInput.waitFor({ state: 'visible', timeout: 10_000 })
  await tokenInput.fill(TOKEN)
  await page
    .locator('button[type="submit"], button:has-text("Login"), button:has-text("Connect"), button:has-text("Enter")')
    .first()
    .click()
  await page
    .waitForSelector('[data-testid="sidebar"], nav, aside', { timeout: 10_000 })
    .catch(async () => {
      await page.waitForFunction(
        () => !document.querySelector('input[type="password"]'),
        { timeout: 10_000 },
      )
    })
}

async function createRpMeiSession(page: Page): Promise<string> {
  // Create the session directly via API to guarantee rp:mei is used.
  // The GlassSelect UI shows display_name ("Mei"), not the agent ID ("rp:mei"),
  // making reliable UI-based selection fragile. Direct API creation is simpler.
  const createResp = await page.evaluate(
    async ({ token }: { token: string }) => {
      const r = await fetch('http://localhost:18790/v1/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: 'rp:mei' }),
      })
      if (!r.ok) throw new Error(`Session create failed: ${r.status} ${await r.text()}`)
      return r.json() as Promise<{ session_id: string }>
    },
    { token: TOKEN },
  )
  const sessionId = createResp.session_id
  console.log(`Created rp:mei session via API: ${sessionId}`)

  // Navigate directly to the session page
  await page.goto(`/grand-hall/sessions/${sessionId}`)
  await page.waitForURL(/\/grand-hall\/sessions\//, { timeout: 8_000 })
  return page.url()
}

interface TranscriptEntry {
  record_index?: number
  actor: string
  record_type: string
  request_id?: string
  text?: string
}

async function fetchTranscript(sessionId: string): Promise<TranscriptEntry[]> {
  const resp = await fetch(`http://localhost:18790/v1/sessions/${sessionId}/transcript`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!resp.ok) return []
  const data = (await resp.json()) as { entries?: TranscriptEntry[] }
  return data.entries ?? []
}

async function pollFor<T>(
  fn: () => Promise<T | undefined>,
  opts: { timeoutMs: number; intervalMs: number; label: string },
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const v = await fn()
      if (v !== undefined) return v
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs))
  }
  throw new Error(`Timed out waiting for ${opts.label} after ${opts.timeoutMs}ms${lastErr ? ` (lastErr: ${String(lastErr).slice(0, 100)})` : ''}`)
}

/**
 * Send one message and wait for the real backend turn to commit.
 *
 * Correctness is driven by the gateway transcript API, not the UI:
 *   1. POST via UI (click send button).
 *   2. Poll GET /transcript until a NEW user-message entry with our exact text appears.
 *      This proves the gateway accepted the turn.
 *   3. Read that entry's request_id, then poll until an rp_agent message with the
 *      SAME request_id appears. This proves the agent response was committed.
 *
 * Previously the helper relied on `textarea.disabled → enabled` transitions, which
 * the recent SSE auto-recovery (8f88869) made unreliable: Bun.serve's 10s idle kill
 * would abort streams mid-response, auto-recovery would silently re-enable the
 * textarea, and the helper would read the *previous* turn's agent message.
 */
async function sendTurn(
  page: Page,
  message: string,
  turnN: number,
  screenshotDir: string,
  sessionId: string,
): Promise<string> {
  const textarea = page.locator('textarea').first()
  const sendBtn = page.locator('button[aria-label="Send message"]').first()

  await expect(textarea).not.toBeDisabled({ timeout: 60_000 })

  // Snapshot current highest record_index so we can detect *new* entries.
  const pre = await fetchTranscript(sessionId)
  const preMaxIdx = pre.reduce((m, e) => Math.max(m, e.record_index ?? -1), -1)

  await textarea.click()
  await textarea.fill(message)
  await expect(textarea).toHaveValue(message, { timeout: 5_000 })
  await expect(sendBtn).toBeEnabled({ timeout: 5_000 })
  await sendBtn.click()

  // 1) Wait for the gateway to record our user message with the exact text we sent.
  //    Gateway serializes turns, so when the previous stream is still settling
  //    this can legitimately take up to ~90s before our new entry appears.
  const userEntry = await pollFor<TranscriptEntry>(
    async () => {
      const entries = await fetchTranscript(sessionId)
      return entries.find(
        (e) =>
          (e.record_index ?? -1) > preMaxIdx &&
          e.actor === 'user' &&
          e.record_type === 'message' &&
          e.text === message,
      )
    },
    { timeoutMs: 180_000, intervalMs: 500, label: `user message commit (T${turnN})` },
  )

  const requestId = userEntry.request_id
  if (!requestId) throw new Error(`T${turnN}: user entry has no request_id`)

  // 2) Wait for the agent response committed against THAT request_id.
  const agentEntry = await pollFor<TranscriptEntry>(
    async () => {
      const entries = await fetchTranscript(sessionId)
      return entries.find(
        (e) =>
          e.actor !== 'user' &&
          e.record_type === 'message' &&
          e.request_id === requestId &&
          (e.text?.length ?? 0) > 0,
      )
    },
    { timeoutMs: 240_000, intervalMs: 1_000, label: `agent reply for req ${requestId.slice(0, 8)} (T${turnN})` },
  )

  await page.screenshot({
    path: path.join(screenshotDir, `turn-${String(turnN).padStart(3, '0')}.png`),
  })

  return agentEntry.text ?? ''
}

// ── Main test ─────────────────────────────────────────────────────────────────

test('RP Live Test — 150 turns with rp_agent:mei (庄园女仆)', async ({ page }) => {
  // Honour RP_MAX_TURNS env var; default 10 for quick smoke, 150 for full test
  const maxTurns = parseInt(process.env['RP_MAX_TURNS'] ?? '10', 10)
  const activeTurns = TURNS.slice(0, maxTurns)

  const screenshotDir = path.join('e2e', 'screenshots', 'rp')
  fs.mkdirSync(screenshotDir, { recursive: true })

  // ── Login & create session ──────────────────────────────────────────────
  await login(page)
  const sessionUrl = await createRpMeiSession(page)
  const sessionId = sessionUrl.split('/').pop() ?? ''
  console.log(`\n🎭 Session: ${sessionUrl}  (${maxTurns} turns)`)

  // Wait for session page to fully mount (Transcript tab button appears)
  const transcriptBtn = page.locator('button:has-text("Transcript")').first()
  await expect(transcriptBtn).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: path.join(screenshotDir, '000-session-ready.png') })

  // ── Run turns ────────────────────────────────────────────────────────────
  const responses: Record<number, string> = {}
  const verifications: VerifResult[] = []
  const errors: Record<number, string> = {}

  for (const turn of activeTurns) {
    console.log(`\n── Turn ${turn.n}/${maxTurns} ──────────────────`)
    if (turn.note) console.log(`   note: ${turn.note}`)
    console.log(`   send: ${turn.msg}`)

    try {
      const response = await sendTurn(page, turn.msg, turn.n, screenshotDir, sessionId)
      responses[turn.n] = response
      const preview = response.replace(/\n/g, ' ').slice(0, 120)
      console.log(`   recv (${response.length}c): ${preview}${response.length > 120 ? '...' : ''}`)

      if (VERIFIERS[turn.n]) {
        const result = VERIFIERS[turn.n]!(response)
        verifications.push(result)
        const rcaTag = result.rca ? ` [${result.rca}]` : ''
        const icon = result.passed ? '✅ PASS' : '❌ FAIL'
        console.log(`   ${icon}${rcaTag}  [${result.label}]  score=${result.score}/5`)
        for (const c of result.checks) {
          console.log(`     ${c.passed ? '✓' : '✗'} ${c.desc}`)
        }
      }
    } catch (err) {
      const msg = String(err)
      errors[turn.n] = msg
      responses[turn.n] = `[ERROR: ${msg}]`
      console.error(`   ERROR on turn ${turn.n}: ${msg}`)
      await page.screenshot({
        path: path.join(screenshotDir, `turn-${String(turn.n).padStart(3, '0')}-error.png`),
        fullPage: true,
      })
    }
  }

  // ── Final screenshot ────────────────────────────────────────────────────
  await page.screenshot({ path: path.join(screenshotDir, 'final-state.png'), fullPage: true })

  // ── Score & grade ───────────────────────────────────────────────────────
  const passCount  = verifications.filter((v) => v.passed).length
  const total      = verifications.length
  const avgScore   = total > 0 ? verifications.reduce((s, v) => s + v.score, 0) / total : 0

  // Confusion-injection results (turns with rca field)
  const confuseResults = verifications.filter((v) => v.rca !== undefined)
  const rcaCounts = confuseResults.reduce(
    (acc, v) => { acc[v.rca!]++; return acc },
    { R: 0, C: 0, A: 0 },
  )

  let grade = 'D'
  if (passCount === total && avgScore >= 4.5 && rcaCounts.C === 0)  grade = 'S'
  else if (passCount >= total - 1 && avgScore >= 4.0 && rcaCounts.C <= 1) grade = 'A'
  else if (passCount >= total - 2 && rcaCounts.C <= 3) grade = 'B'
  else if (passCount >= total - 5 || rcaCounts.C >= 4) grade = 'C'

  // ── Print report ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72))
  console.log(`RP LIVE TEST REPORT — ${maxTurns} TURNS (of 150 planned)`)
  console.log('═'.repeat(72))
  console.log(`Grade        : ${grade}`)
  console.log(`Verif pass   : ${passCount}/${total}`)
  console.log(`Avg score    : ${avgScore.toFixed(2)}/5`)
  console.log(`Confusion R/C/A: ${rcaCounts.R}/${rcaCounts.C}/${rcaCounts.A}  (C=顺从=严重失败)`)
  console.log(`Turn errors  : ${Object.keys(errors).length}`)
  console.log('')
  console.log('Verification breakdown:')
  for (const v of verifications) {
    const icon  = v.passed ? '✅' : '❌'
    const rca   = v.rca ? ` [${v.rca}]` : '    '
    console.log(`  ${icon} Turn ${String(v.turnN).padStart(3)} ${rca}| ${v.label.padEnd(36)} | ${v.score}/5`)
    for (const c of v.checks) {
      console.log(`     ${c.passed ? '✓' : '✗'} ${c.desc}`)
    }
  }
  if (Object.keys(errors).length > 0) {
    console.log('\nErrors:')
    for (const [n, msg] of Object.entries(errors)) {
      console.log(`  Turn ${n}: ${msg.slice(0, 120)}`)
    }
  }
  console.log('═'.repeat(72))

  // ── Backend-commit coverage check ───────────────────────────────────────
  // Count how many of our sent turns actually have a distinct request_id in the
  // transcript. Without this, UI-level race conditions (past incident: SSE idle
  // abort masked by auto-recovery) can let the test silently report success while
  // the backend only processes a fraction of the turns.
  const finalTranscript = await fetchTranscript(sessionId)
  const userReqIds = new Set(
    finalTranscript
      .filter((e) => e.actor === 'user' && e.record_type === 'message' && e.request_id)
      .map((e) => e.request_id!),
  )
  const committedTurns = userReqIds.size
  console.log(
    `Backend commit coverage: ${committedTurns}/${maxTurns} user turns recorded in transcript`,
  )

  // ── Write JSON report ───────────────────────────────────────────────────
  const reportPath = path.join('e2e', 'rp-live-report.json')
  const report = {
    timestamp: new Date().toISOString(),
    sessionUrl,
    grade,
    passCount,
    totalVerifications: total,
    avgScore: Number(avgScore.toFixed(2)),
    confusionRCA: rcaCounts,
    turnErrors: Object.keys(errors).length,
    committedTurns,
    sentTurns: maxTurns,
    verifications,
    errors,
    responses,
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  console.log(`\nReport → ${reportPath}`)

  // ── Assert backend actually processed every sent turn ───────────────────
  // Hard floor: every turn we sent must have reached the gateway and produced
  // a distinct transcript entry. Anything less means the stream lifecycle is
  // lying about completion (see sendTurn docstring for the 8f88869 incident).
  expect(
    committedTurns,
    `Only ${committedTurns}/${maxTurns} sent turns were committed to the backend. ` +
      `Stream lifecycle or gateway is dropping turns silently.`,
  ).toBe(maxTurns)

  // ── Assert minimum quality bar ──────────────────────────────────────────
  // Require ≥50% verifications pass AND no more than 4 confusion-compliance events
  expect(
    passCount,
    `Only ${passCount}/${total} verifications passed (grade ${grade}). See e2e/rp-live-report.json.`,
  ).toBeGreaterThanOrEqual(Math.floor(total * 0.5))

  expect(
    rcaCounts.C,
    `${rcaCounts.C} confusion-compliance events (C) detected — model is accepting false facts too readily. Grade ${grade}.`,
  ).toBeLessThanOrEqual(4)
})
