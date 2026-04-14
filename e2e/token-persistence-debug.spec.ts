import { expect, test, type Page, type Request, type Response } from '@playwright/test'

const TOKEN = 'diag-token-xyz'
const AGENT_ID = 'rp:alice'

interface NetLog {
  url: string
  method: string
  status: number
  authHeader: string | null
}

function wireNetworkLog(page: Page): NetLog[] {
  const log: NetLog[] = []
  page.on('response', (res: Response) => {
    const req: Request = res.request()
    const url = req.url()
    if (!url.includes('localhost:18790')) return
    log.push({
      url: url.replace('http://localhost:18790', ''),
      method: req.method(),
      status: res.status(),
      authHeader: req.headers()['authorization'] ?? null,
    })
  })
  return log
}

async function stubGateway(page: Page, opts: { studyReturns401: boolean }) {
  await page.route('http://localhost:18790/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path === '/health' || path.endsWith('/health')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
      return
    }
    if (path.includes('/study') || path.includes('/agents/') || path.includes('/memory/')) {
      if (opts.studyReturns401) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'nope' } }),
        })
        return
      }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], results: [], data: [], snapshot: {} }),
    })
  })
}

async function login(page: Page) {
  await page.goto('/')
  const input = page.locator('input[type="password"]').first()
  await input.waitFor({ state: 'visible', timeout: 10_000 })
  await input.fill(TOKEN)
  await page.locator('button[type="submit"]').first().click()
  await input.waitFor({ state: 'hidden', timeout: 10_000 })
}

test.describe('token persistence on Study navigation', () => {
  test('scenario A: gateway OK everywhere — token must persist into Study', async ({ page }) => {
    const netLog = wireNetworkLog(page)
    await stubGateway(page, { studyReturns401: false })
    await login(page)

    const tokenAfterLogin = await page.evaluate(() => localStorage.getItem('mc:token'))
    console.log('[A] localStorage mc:token after login:', tokenAfterLogin)
    expect(tokenAfterLogin).toContain(TOKEN)

    await page.goto(`/study/${encodeURIComponent(AGENT_ID)}/episodes`)
    await page.waitForTimeout(1500)

    const loginVisible = await page.locator('input[type="password"]').isVisible().catch(() => false)
    const tokenAfterNav = await page.evaluate(() => localStorage.getItem('mc:token'))
    console.log('[A] login screen visible after study nav?', loginVisible)
    console.log('[A] localStorage mc:token after study nav:', tokenAfterNav)
    console.log('[A] network log:', JSON.stringify(netLog, null, 2))

    expect(loginVisible).toBe(false)
    expect(tokenAfterNav).toContain(TOKEN)
  })

  test('scenario C: legacy sessionStorage token migrates to localStorage', async ({ page }) => {
    await stubGateway(page, { studyReturns401: false })
    await page.goto('/')
    await page.evaluate(
      ([key, val]) => {
        sessionStorage.setItem(key, JSON.stringify(val))
        localStorage.removeItem(key)
      },
      ['mc:token', 'legacy-token-abc'],
    )
    await page.reload()

    const loginVisible = await page.locator('input[type="password"]').isVisible().catch(() => false)
    const local = await page.evaluate(() => localStorage.getItem('mc:token'))
    const session = await page.evaluate(() => sessionStorage.getItem('mc:token'))
    console.log('[C] login screen visible?', loginVisible)
    console.log('[C] localStorage mc:token:', local)
    console.log('[C] sessionStorage mc:token:', session)

    expect(loginVisible).toBe(false)
    expect(local).toContain('legacy-token-abc')
    expect(session).toBeNull()
  })

  test('scenario B: gateway 401s Study endpoints — does token get wiped?', async ({ page }) => {
    const netLog = wireNetworkLog(page)
    await stubGateway(page, { studyReturns401: true })
    await login(page)

    const tokenAfterLogin = await page.evaluate(() => localStorage.getItem('mc:token'))
    console.log('[B] localStorage mc:token after login:', tokenAfterLogin)

    await page.goto(`/study/${encodeURIComponent(AGENT_ID)}/episodes`)
    await page.waitForTimeout(1500)

    const loginVisible = await page.locator('input[type="password"]').isVisible().catch(() => false)
    const tokenAfterNav = await page.evaluate(() => localStorage.getItem('mc:token'))
    console.log('[B] login screen visible after study nav?', loginVisible)
    console.log('[B] localStorage mc:token after study nav:', tokenAfterNav)
    console.log('[B] network log:', JSON.stringify(netLog, null, 2))

    const bounced = loginVisible || tokenAfterNav === null
    console.log('[B] bounced to login?', bounced)
  })
})
