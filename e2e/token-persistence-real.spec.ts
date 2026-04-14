import { expect, test, type Page, type Request, type Response } from '@playwright/test'

const TOKEN = process.env.E2E_TOKEN ?? 'maidsclaw'
const AGENT_ID = 'rp:alice'

interface NetEvent {
  url: string
  method: string
  status: number
  hasAuth: boolean
}

function wireNetLog(page: Page): NetEvent[] {
  const log: NetEvent[] = []
  page.on('response', (res: Response) => {
    const req: Request = res.request()
    const url = req.url()
    if (!url.includes('localhost:18790')) return
    log.push({
      url: url.replace('http://localhost:18790', ''),
      method: req.method(),
      status: res.status(),
      hasAuth: Boolean(req.headers()['authorization']),
    })
  })
  return log
}

async function loginAndVerify(page: Page) {
  await page.goto('/')
  const input = page.locator('input[type="password"]').first()
  await input.waitFor({ state: 'visible', timeout: 10_000 })
  await input.fill(TOKEN)
  await page.locator('button[type="submit"]').first().click()
  await input.waitFor({ state: 'hidden', timeout: 10_000 })
  const stored = await page.evaluate(() => ({
    local: localStorage.getItem('mc:token'),
    session: sessionStorage.getItem('mc:token'),
  }))
  console.log('[login] stored:', stored)
  return stored
}

test('REAL gateway: hard reload on /study/* keeps token', async ({ page }) => {
  wireNetLog(page)
  await loginAndVerify(page)
  await page.goto(`/study/${encodeURIComponent(AGENT_ID)}/episodes`)
  await page.waitForTimeout(1500)
  await page.reload()
  await page.waitForTimeout(2000)
  const loginVisible = await page.locator('input[type="password"]').isVisible().catch(() => false)
  const local = await page.evaluate(() => localStorage.getItem('mc:token'))
  console.log('[reload] loginVisible:', loginVisible, 'local:', local)
  expect(loginVisible).toBe(false)
  expect(local).toContain(TOKEN)
})

test('REAL gateway: new context (simulates new tab) reads same localStorage', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const pageA = await ctxA.newPage()
  await pageA.goto('/')
  const input = pageA.locator('input[type="password"]').first()
  await input.waitFor({ state: 'visible', timeout: 10_000 })
  await input.fill(TOKEN)
  await pageA.locator('button[type="submit"]').first().click()
  await input.waitFor({ state: 'hidden', timeout: 10_000 })
  const storageState = await ctxA.storageState()
  console.log('[ctxA] storageState origin count:', storageState.origins.length)
  for (const o of storageState.origins) {
    console.log(`  origin=${o.origin} localStorage entries=${String(o.localStorage?.length ?? 0)}`)
    for (const kv of o.localStorage ?? []) console.log(`    ${kv.name}=${kv.value}`)
  }
  await ctxA.close()

  const ctxB = await browser.newContext({ storageState })
  const pageB = await ctxB.newPage()
  await pageB.goto(`/study/${encodeURIComponent(AGENT_ID)}/episodes`)
  await pageB.waitForTimeout(2000)
  const loginVisible = await pageB.locator('input[type="password"]').isVisible().catch(() => false)
  const local = await pageB.evaluate(() => localStorage.getItem('mc:token'))
  console.log('[ctxB] loginVisible:', loginVisible, 'local:', local)
  expect(loginVisible).toBe(false)
  expect(local).toContain(TOKEN)
  await ctxB.close()
})

test('REAL gateway: navigate home → study and record everything', async ({ page }) => {
  const netLog = wireNetLog(page)

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[browser ${msg.type()}]`, msg.text())
    }
  })

  await loginAndVerify(page)

  console.log('--- navigating to /study/rp:alice/episodes ---')
  await page.goto(`/study/${encodeURIComponent(AGENT_ID)}/episodes`)
  await page.waitForTimeout(3000)

  const loginVisible = await page.locator('input[type="password"]').isVisible().catch(() => false)
  const afterNav = await page.evaluate(() => ({
    local: localStorage.getItem('mc:token'),
    session: sessionStorage.getItem('mc:token'),
  }))

  console.log('[after study nav] login screen visible?', loginVisible)
  console.log('[after study nav] storage:', afterNav)
  console.log('[after study nav] full network log:')
  for (const ev of netLog) {
    const marker = ev.status === 401 ? ' <<< 401' : ev.status >= 400 ? ' <<< err' : ''
    console.log(`  ${String(ev.status)} ${ev.method} ${ev.url}${ev.hasAuth ? '' : ' (NO AUTH)'}${marker}`)
  }

  await page.screenshot({ path: 'e2e/screenshots/token-persistence-real.png', fullPage: true })

  const unauthorizedHits = netLog.filter((e) => e.status === 401)
  console.log('[summary] 401 count:', unauthorizedHits.length)
  console.log('[summary] token after nav is null?', afterNav.local === null)
  console.log('[summary] bounced to login?', loginVisible)

  expect(loginVisible, 'should not be re-prompted for login after navigating to Study').toBe(false)
})
