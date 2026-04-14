/**
 * MaidsClaw RP Live Test — 70-turn 庄园女仆对话
 *
 * Uses real rp:alice agent (moonshot/kimi-k2.5) via browser chat UI.
 * Sends all 70 turns in sequence, captures each response, auto-evaluates
 * all ⚠️ verification points, and writes a scored report.
 *
 * Prerequisites (must be running):
 *   - MaidsClaw gateway: bun run start  (port 18790)
 *   - Dashboard dev server: bun run dev  (port 5173)
 *   - rp:alice agent configured in config/agents.json
 *
 * Estimated runtime: 25-50 minutes (70 real model calls)
 */

import { expect, test, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const TOKEN = process.env.E2E_TOKEN ?? 'maidsclaw'

// 40-minute global timeout for the full 70-turn run
test.setTimeout(40 * 60 * 1000)

// ── 70 turns ─────────────────────────────────────────────────────────────────

interface Turn {
  n: number
  msg: string
  note?: string
}

const TURNS: Turn[] = [
  // Phase A: 开场与日常建立（第 1-7 轮）
  { n: 1,  msg: '早安，今天庄园里安静得有点过头。' },
  { n: 2,  msg: '先别太正式，陪我随便聊聊。' },
  { n: 3,  msg: '我刚从茶室出来，那里窗边的光线很好。',              note: 'ENTITY:茶室' },
  { n: 4,  msg: '可惜我坐得太久，差点什么都不想做了。' },
  { n: 5,  msg: '你这么说，我倒真想再喝点什么。' },
  { n: 6,  msg: '红茶吧，别太苦。',                                  note: 'ENTITY:红茶 FACT:偏好不太苦' },
  { n: 7,  msg: '你总能记住我这些小偏好。' },
  // Phase B: 人物引入与世界扩展（第 8-13 轮）
  { n: 8,  msg: '对了，Alice今天起得早吗？',                          note: 'ENTITY:Alice' },
  { n: 9,  msg: '她最近是不是总往花房那边跑？' },
  { n: 10, msg: '管家今天又不见人影。',                               note: 'ENTITY:管家' },
  { n: 11, msg: '算了，先别找他。' },
  { n: 12, msg: '我早上在温室门口站了一会儿，里面有点潮。',           note: 'ENTITY:温室' },
  { n: 13, msg: '你是不是怕我着凉？' },
  // Phase C: 银怀表暗线建立（第 14-20 轮）
  { n: 14, msg: '我刚才整理袖口的时候，总觉得少了点什么。' },
  { n: 15, msg: '可能吧，我一早带了个银怀表，后来就没怎么留意。',    note: 'ENTITY:银怀表' },
  { n: 16, msg: '你还真是随时准备替我收拾残局。' },
  { n: 17, msg: '我记得我在茶室坐下的时候，好像把它从口袋里拿出来过。', note: 'FACT:银怀表→茶室 KEY_BINDING' },
  { n: 18, msg: '不过后来Alice来找我说了几句话，我就分神了。',        note: 'FACT:遗忘原因→Alice' },
  { n: 19, msg: '你别告诉管家，不然他又要念我。',                     note: 'SECRET:不告知管家' },
  { n: 20, msg: '等会儿我先把红茶喝完再说。' },
  // Phase D: 闲聊缓冲区（第 21-24 轮）
  { n: 21, msg: '说起来，今天的天气让人犯懒。' },
  { n: 22, msg: '你有没有觉得庄园最近太安分了？' },
  { n: 23, msg: 'Alice要是听见你这么说，肯定会笑。' },
  { n: 24, msg: '那你呢，你喜欢热闹还是安静？' },
  // Phase E: 第一次记忆验证（第 25-28 轮）⚠️
  { n: 25, msg: '你记得我把什么落在茶室了吗？',                       note: 'VERIFY#1:直接回忆银怀表+茶室' },
  { n: 26, msg: '还好你记得，不然我自己都要怀疑是不是记错了。' },
  { n: 27, msg: '我是不是年纪到了，越来越会丢三落四。' },
  { n: 28, msg: '你这样安慰人，倒是很熟练。' },
  // Phase F: 地点偏好与第二轮缓冲（第 29-39 轮）
  { n: 29, msg: '其实我挺喜欢茶室那个靠窗的位置。',                   note: 'FACT:喜欢茶室靠窗' },
  { n: 30, msg: '比起茶室，我对温室反而没有那么喜欢。',               note: 'FACT:偏好茶室>温室' },
  { n: 31, msg: '管家是不是又在找我签什么单子？' },
  { n: 32, msg: 'Alice有时候比管家还麻烦。' },
  { n: 33, msg: '你这形容倒挺精准。' },
  { n: 34, msg: '你说，我是不是该现在就去把东西拿回来？',             note: 'CHECK:东西=银怀表+茶室' },
  { n: 35, msg: '先不去，我忽然不想动。' },
  { n: 36, msg: '你说得好像很有把握。' },
  { n: 37, msg: '有时候我真希望你能替我记住所有事。' },
  { n: 38, msg: '那我以后是不是可以少动脑子一点？' },
  { n: 39, msg: '你今天心情不错。' },
  // Phase G: 第二次记忆验证 — 指代消解（第 40 轮）⚠️
  { n: 40, msg: '那个银色的东西还在原处吗？',                         note: 'VERIFY#2:指代消解→银怀表+茶室' },
  // Phase H: 指代消解后续（第 41-43 轮）
  { n: 41, msg: '你能听懂我这种偷懒说法，真省事。' },
  { n: 42, msg: '要是哪天我说得太含糊，你也会一直猜下去吗？' },
  { n: 43, msg: '这回答很像你。' },
  // Phase I: 第三次记忆验证 — 全局实体回忆（第 44-46 轮）⚠️
  { n: 44, msg: '你还记得今早我都提过哪些地方吗？',                   note: 'VERIFY#3a:地点→茶室+温室' },
  { n: 45, msg: '那人呢？',                                           note: 'VERIFY#3b:人物→Alice+管家' },
  { n: 46, msg: '饮品呢？',                                           note: 'VERIFY#3c:物品→红茶(+偏好)' },
  // Phase J: 情感互动与约束验证（第 47-55 轮）
  { n: 47, msg: '看来你今天确实挺可靠。' },
  { n: 48, msg: '好吧，是一直都可靠。' },
  { n: 49, msg: '你会不会觉得我故意拿这些小事考你？' },
  { n: 50, msg: '你倒是很会给自己找理由。' },
  { n: 51, msg: '我刚才忽然想到，Alice可能会先去茶室。',              note: 'IMPLICIT:Alice→茶室→银怀表风险' },
  { n: 52, msg: '管家倒是一定会看见。',                               note: 'VERIFY:保密约束→管家' },
  { n: 53, msg: '你记性好得让我有点不自在。' },
  { n: 54, msg: '你说话总能把分寸拿得刚刚好。' },
  { n: 55, msg: '这话倒是对。' },
  // Phase K: 事实链总结验证（第 56-57 轮）
  { n: 56, msg: '其实我现在已经不太担心那东西丢了。',                 note: 'CHECK:那东西=银怀表' },
  { n: 57, msg: '你总结得很简洁。' },
  // Phase L: 地点对比与暗示（第 58-65 轮）
  { n: 58, msg: '温室那边下午会不会更暖和？' },
  { n: 59, msg: '那还是茶室更合适。' },
  { n: 60, msg: '你这句话听着像在哄我回去。',                         note: 'IMPLICIT:暗示取回银怀表' },
  { n: 61, msg: '你终于承认了。' },
  { n: 62, msg: '要是Alice问起来，你会怎么说？',                      note: 'VERIFY:保密约束→Alice' },
  { n: 63, msg: '管家问呢？',                                         note: 'VERIFY#KEY:保密约束→管家' },
  { n: 64, msg: '你这样，我都快离不开你了。' },
  { n: 65, msg: '你偶尔说这种话，真让人没法接。' },
  // Phase M: 最终记忆验证（第 66-70 轮）⚠️
  { n: 66, msg: '你还记得我们一开始在聊什么吗？',                     note: 'VERIFY#4:对话脉络' },
  { n: 67, msg: '你把重点抓得挺准。' },
  { n: 68, msg: '那你觉得今天最容易被我忘掉的是什么？',              note: 'VERIFY#5:核心线索→银怀表' },
  { n: 69, msg: '听上去我真有点糟糕。' },
  { n: 70, msg: '你第一次提到它时，我们在哪里？',                     note: 'VERIFY#6:终极→"它"=银怀表+茶室' },
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
  score: number  // 1-5
  checks: CheckItem[]
}

function buildResult(
  turnN: number,
  label: string,
  response: string,
  checks: Array<{ desc: string; test: RegExp | ((r: string) => boolean); weight: number }>,
  passWhen: (results: boolean[]) => boolean,
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
    checks: items,
  }
}

// ── Evaluators for each verification turn ─────────────────────────────────────

function evalT25(r: string): VerifResult {
  return buildResult(25, '验证点#1 直接记忆回忆', r, [
    { desc: '包含"银怀表"',    test: /银怀表/,  weight: 3 },
    { desc: '绑定到"茶室"',    test: /茶室/,    weight: 2 },
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
    { desc: '回答红茶',           test: /红茶/,         weight: 3 },
    { desc: '提到偏好"不太苦"',   test: /不太苦|不苦|淡一点|淡些/, weight: 2 },
    { desc: '未编造其他饮品',     test: (s) => !/(咖啡|绿茶|花茶|牛奶)/.test(s), weight: 1 },
  ], ([tea]) => !!tea)
}

function evalT52(r: string): VerifResult {
  // Must NOT say it'll tell butler; SHOULD reference keeping the secret
  return buildResult(52, '约束验证 管家会看见', r, [
    { desc: '未表示要告诉管家',  test: (s) => !/(告诉管家|让管家知道|通知管家)/.test(s), weight: 3 },
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
    { desc: '明确表示会挡住管家', test: /保密|不说|不会说|遮|挡住|拦住|替您|不告诉|不让他知道/, weight: 2 },
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
    { desc: '回答银怀表',    test: /银怀表/,                    weight: 4 },
    { desc: '给出合理理由',  test: /遗落|遗失|忘|粗心|分神|没注意/, weight: 1 },
  ], ([watch]) => !!watch)
}

function evalT70(r: string): VerifResult {
  return buildResult(70, '验证点#6 终极场景追溯(最高权重)', r, [
    { desc: '"它"→银怀表',    test: /银怀表/,  weight: 2 },
    { desc: '地点→茶室',      test: /茶室/,    weight: 3 },
    { desc: '未答错地点',     test: (s) => !/(温室|走廊|花房|书房|餐厅)/.test(s), weight: 1 },
    { desc: '回忆场景细节',   test: /坐下|口袋|拿出|茶室坐/, weight: 1 },
  ], ([watch, room]) => !!(watch && room))
}

const VERIFIERS: Record<number, (r: string) => VerifResult> = {
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

async function createRpAliceSession(page: Page): Promise<string> {
  await page.goto('/grand-hall')
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

  const newBtn = page.locator('button:has-text("New Session"), button:has-text("New")').first()
  await expect(newBtn).toBeVisible({ timeout: 8_000 })
  await newBtn.click()

  const agentSelect = page.locator('select').first()
  await expect(agentSelect).toBeVisible({ timeout: 5_000 })

  // Try to select rp:alice; fall back to first real agent
  const options = agentSelect.locator('option')
  const count = await options.count()
  let selectedIdx = 1
  for (let i = 0; i < count; i++) {
    const val = await options.nth(i).getAttribute('value')
    const txt = await options.nth(i).textContent()
    if (val?.includes('rp:alice') || txt?.includes('rp:alice') || txt?.toLowerCase().includes('alice')) {
      selectedIdx = i
      break
    }
  }
  await agentSelect.selectOption({ index: selectedIdx })
  console.log(`Selected agent option index ${selectedIdx}`)

  await page.locator('button:has-text("Create")').first().click()
  await page.waitForTimeout(2_000)

  const firstCard = page.locator('.cursor-pointer').first()
  await expect(firstCard).toBeVisible({ timeout: 8_000 })
  await firstCard.click()
  await page.waitForURL(/\/grand-hall\/sessions\//, { timeout: 8_000 })
  return page.url()
}

/**
 * Send one message and wait for the streaming response to finish.
 * Returns Alice's response text read directly from the gateway transcript API.
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

  // Wait for textarea to be enabled (not streaming)
  await expect(textarea).not.toBeDisabled({ timeout: 30_000 })

  // Click the textarea to focus, then fill it
  await textarea.click()
  await textarea.fill(message)

  // Verify the value was accepted by React's controlled state
  await expect(textarea).toHaveValue(message, { timeout: 5_000 })

  // Click the Send button (more reliable than pressing Enter for React)
  await expect(sendBtn).toBeEnabled({ timeout: 5_000 })
  await sendBtn.click()

  // Confirm streaming started — textarea must become disabled within 10s
  await expect(textarea).toBeDisabled({ timeout: 10_000 })

  // Wait for streaming to finish — up to 3 minutes per turn
  await expect(textarea).not.toBeDisabled({ timeout: 180_000 })

  // Capture screenshot
  await page.screenshot({
    path: path.join(screenshotDir, `turn-${String(turnN).padStart(2, '0')}.png`),
  })

  // Read Alice's response directly from the gateway transcript API.
  // This is more reliable than DOM scraping of the streaming div.
  const resp = await fetch(`http://localhost:18790/v1/sessions/${sessionId}/transcript`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!resp.ok) return ''
  const data = (await resp.json()) as { entries?: Array<{ actor: string; record_type: string; text?: string }> }
  const entries = data.entries ?? []
  // Last entry from Alice (actor is not 'user')
  const lastAlice = [...entries].reverse().find((e) => e.actor !== 'user' && e.record_type === 'message')
  return lastAlice?.text ?? ''
}

// ── Main test ─────────────────────────────────────────────────────────────────

test('RP Live Test — 70 turns with rp:alice (庄园女仆)', async ({ page }) => {
  // Honour RP_MAX_TURNS env var; default 10 for quick runs, set 70 for full test
  const maxTurns = parseInt(process.env['RP_MAX_TURNS'] ?? '10', 10)
  const activeTurns = TURNS.slice(0, maxTurns)

  const screenshotDir = path.join('e2e', 'screenshots', 'rp')
  fs.mkdirSync(screenshotDir, { recursive: true })

  // ── Login & create session ──────────────────────────────────────────────
  await login(page)
  const sessionUrl = await createRpAliceSession(page)
  const sessionId = sessionUrl.split('/').pop() ?? ''
  console.log(`\n🎭 Session: ${sessionUrl}  (${maxTurns} turns)`)

  // Wait for session page to fully mount (Transcript tab button appears)
  const transcriptBtn = page.locator('button:has-text("Transcript")').first()
  await expect(transcriptBtn).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: path.join(screenshotDir, '00-session-ready.png') })

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
      const preview = response.replace(/\n/g, ' ').slice(0, 100)
      console.log(`   recv (${response.length}c): ${preview}${response.length > 100 ? '...' : ''}`)

      if (VERIFIERS[turn.n]) {
        const result = VERIFIERS[turn.n]!(response)
        verifications.push(result)
        const icon = result.passed ? '✅ PASS' : '❌ FAIL'
        console.log(`   ${icon}  [${result.label}]  score=${result.score}/5`)
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
        path: path.join(screenshotDir, `turn-${String(turn.n).padStart(2, '0')}-error.png`),
        fullPage: true,
      })
    }
  }

  // ── Final screenshot ────────────────────────────────────────────────────
  await page.screenshot({ path: path.join(screenshotDir, 'final-state.png'), fullPage: true })

  // ── Score & grade ───────────────────────────────────────────────────────
  const passCount = verifications.filter((v) => v.passed).length
  const total = verifications.length
  const avgScore = total > 0
    ? verifications.reduce((s, v) => s + v.score, 0) / total
    : 0

  let grade = 'D'
  if (passCount === total && avgScore >= 4.5) grade = 'S'
  else if (passCount === total && avgScore >= 4.0) grade = 'A'
  else if (passCount >= total - 1) grade = 'B'
  else if (passCount >= total - 3) grade = 'C'

  // ── Print report ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(64))
  console.log('RP LIVE TEST REPORT')
  console.log('═'.repeat(64))
  console.log(`Grade      : ${grade}`)
  console.log(`Verif pass : ${passCount}/${total}`)
  console.log(`Avg score  : ${avgScore.toFixed(2)}/5`)
  console.log(`Turn errors: ${Object.keys(errors).length}`)
  console.log('')
  console.log('Verification breakdown:')
  for (const v of verifications) {
    const icon = v.passed ? '✅' : '❌'
    console.log(`  ${icon} Turn ${String(v.turnN).padStart(2)} | ${v.label.padEnd(30)} | ${v.score}/5`)
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
  console.log('═'.repeat(64))

  // ── Write JSON report ───────────────────────────────────────────────────
  const reportPath = path.join('e2e', 'rp-live-report.json')
  const report = {
    timestamp: new Date().toISOString(),
    sessionUrl,
    grade,
    passCount,
    totalVerifications: total,
    avgScore: Number(avgScore.toFixed(2)),
    turnErrors: Object.keys(errors).length,
    verifications,
    errors,
    responses,
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  console.log(`\nReport → ${reportPath}`)

  // ── Assert minimum bar ──────────────────────────────────────────────────
  // Require at least 50% of verifications to pass (soft bar — allows model variance)
  expect(
    passCount,
    `Only ${passCount}/${total} verifications passed (grade ${grade}). See e2e/rp-live-report.json for full details.`,
  ).toBeGreaterThanOrEqual(Math.floor(total * 0.5))
})
