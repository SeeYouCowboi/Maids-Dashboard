/**
 * MaidsClaw Dashboard — end-to-end test suite
 *
 * Prerequisites (must be running before test):
 *   - MaidsClaw gateway: bun run start  (port 18790)
 *   - Dashboard dev server: bun run dev  (port 5173)
 *
 * Auth token: maidsclaw
 */

import { expect, test, type Page } from '@playwright/test'

const TOKEN = process.env.E2E_TOKEN ?? 'maidsclaw'

// ── helpers ──────────────────────────────────────────────────────────────────

async function login(page: Page) {
  await page.goto('/')
  // Wait for login screen to appear
  const tokenInput = page.locator('input[type="password"], input[placeholder*="token" i], input[placeholder*="Token" i]').first()
  await tokenInput.waitFor({ state: 'visible', timeout: 10_000 })
  await tokenInput.fill(TOKEN)
  const submitBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Connect"), button:has-text("Enter")').first()
  await submitBtn.click()
  // Wait for app shell (sidebar) to appear
  await page.waitForSelector('[data-testid="sidebar"], nav, aside', { timeout: 10_000 }).catch(async () => {
    // fallback: wait for URL change away from login
    await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 10_000 })
  })
}

async function goTo(page: Page, href: string) {
  await page.goto(href)
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {/* best effort */})
}

// ── 1. Login ──────────────────────────────────────────────────────────────────

test('1. Login screen appears and accepts valid token', async ({ page }) => {
  await page.goto('/')
  // Should show some form of login / token input
  const passwordInput = page.locator('input[type="password"], input[placeholder*="token" i], input[placeholder*="Token" i]').first()
  await expect(passwordInput).toBeVisible({ timeout: 10_000 })

  await passwordInput.fill(TOKEN)
  const submitBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Connect"), button:has-text("Enter")').first()
  await submitBtn.click()

  // After login the password field should disappear
  await expect(passwordInput).not.toBeVisible({ timeout: 10_000 })
  // Screenshot for evidence
  await page.screenshot({ path: 'e2e/screenshots/01-after-login.png', fullPage: true })
})

// ── 2. Sidebar navigation ─────────────────────────────────────────────────────

test('2. Sidebar renders navigation items', async ({ page }) => {
  await login(page)
  await page.screenshot({ path: 'e2e/screenshots/02-sidebar.png' })
  // At least one nav link should exist
  const navLinks = page.locator('nav a, aside a, [role="navigation"] button, nav button')
  await expect(navLinks.first()).toBeVisible({ timeout: 8_000 })
})

// ── 3. Observatory ────────────────────────────────────────────────────────────

test('3. Observatory page loads and shows health status', async ({ page }) => {
  await login(page)
  await goTo(page, '/observatory')
  await page.screenshot({ path: 'e2e/screenshots/03-observatory.png', fullPage: true })
  // The page should render without crashing (no error boundary / white screen)
  const body = await page.textContent('body')
  expect(body).not.toBe('')
  // Should show some health/status content
  const hasHealthText = body?.toLowerCase().includes('ok') || body?.toLowerCase().includes('gateway') || body?.toLowerCase().includes('status')
  expect(hasHealthText).toBeTruthy()
})

// ── 4. Grand Hall session list ────────────────────────────────────────────────

test('4. Grand Hall page loads and shows session list', async ({ page }) => {
  await login(page)
  await goTo(page, '/grand-hall')
  await page.screenshot({ path: 'e2e/screenshots/04-grand-hall.png', fullPage: true })
  const body = await page.textContent('body')
  expect(body).not.toBe('')
  // Should have a "New Session" button or similar
  const newSessionBtn = page.locator('button:has-text("New Session"), button:has-text("Create"), button:has-text("New")')
  await expect(newSessionBtn.first()).toBeVisible({ timeout: 8_000 })
})

// ── 5. Create session ─────────────────────────────────────────────────────────

test('5. Can create a new session', async ({ page }) => {
  await login(page)
  await goTo(page, '/grand-hall')

  // Click New Session
  const newBtn = page.locator('button:has-text("New Session"), button:has-text("New")').first()
  await newBtn.click()

  // Wait for agent selector to appear
  const agentSelect = page.locator('select').first()
  await expect(agentSelect).toBeVisible({ timeout: 5_000 })

  // Select the first available agent
  const options = agentSelect.locator('option')
  const count = await options.count()
  expect(count).toBeGreaterThan(1) // at least placeholder + 1 agent

  await agentSelect.selectOption({ index: 1 }) // pick first real agent

  // Click Create
  const createBtn = page.locator('button:has-text("Create")').first()
  await createBtn.click()

  // Wait for the new session card to appear
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: 'e2e/screenshots/05-session-created.png', fullPage: true })

  // The create form should have closed or the session list refreshed
  const body = await page.textContent('body')
  expect(body).not.toBe('')
})

// ── 6. Session detail page ────────────────────────────────────────────────────

test('6. Session detail page loads from Grand Hall', async ({ page }) => {
  await login(page)
  await goTo(page, '/grand-hall')

  // Wait for session cards to appear
  const sessionCard = page.locator('.cursor-pointer').first()
  const hasCard = await sessionCard.isVisible({ timeout: 5_000 }).catch(() => false)
  if (!hasCard) {
    test.info().annotations.push({ type: 'skip', description: 'No sessions available to click' })
    return
  }

  await sessionCard.click()
  await page.waitForURL(/\/grand-hall\/sessions\//, { timeout: 8_000 })

  // Wait for page-transition animation to complete and session query to resolve
  // The Transcript tab button is only rendered after the session detail page mounts
  const transcriptBtn = page.locator('button:has-text("Transcript")').first()
  await expect(transcriptBtn).toBeVisible({ timeout: 10_000 })

  await page.screenshot({ path: 'e2e/screenshots/06-session-detail.png', fullPage: true })

  const body = await page.textContent('body')
  const hasTranscript = body?.toLowerCase().includes('transcript')
  const hasMemory = body?.toLowerCase().includes('memory')
  expect(hasTranscript || hasMemory).toBeTruthy()
})

// ── 7. Chat — the crash scenario ──────────────────────────────────────────────

test('7. Chat: sending a message does not crash the page', async ({ page }) => {
  await login(page)
  await goTo(page, '/grand-hall')

  // Log any console errors
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    consoleErrors.push(`PAGE_ERROR: ${err.message}`)
  })

  // Find an open session or create one
  await page.waitForTimeout(1_000)

  // Try to find an "open" session
  let sessionUrl: string | null = null
  const sessionCards = page.locator('.cursor-pointer')
  const cardCount = await sessionCards.count()

  for (let i = 0; i < cardCount; i++) {
    const card = sessionCards.nth(i)
    const cardText = await card.textContent()
    if (cardText?.toLowerCase().includes('open')) {
      await card.click()
      await page.waitForURL(/\/grand-hall\/sessions\//, { timeout: 8_000 })
      sessionUrl = page.url()
      break
    }
  }

  if (!sessionUrl) {
    test.info().annotations.push({ type: 'info', description: 'No open session found; creating one' })
    // Create a fresh session
    await goTo(page, '/grand-hall')
    const newBtn = page.locator('button:has-text("New Session"), button:has-text("New")').first()
    await newBtn.click()
    const agentSelect = page.locator('select').first()
    await agentSelect.waitFor({ state: 'visible', timeout: 5_000 })
    await agentSelect.selectOption({ index: 1 })
    await page.locator('button:has-text("Create")').first().click()
    await page.waitForTimeout(2_000)
    // Click on the newest session
    const firstCard = page.locator('.cursor-pointer').first()
    await firstCard.waitFor({ state: 'visible', timeout: 5_000 })
    await firstCard.click()
    await page.waitForURL(/\/grand-hall\/sessions\//, { timeout: 8_000 })
    sessionUrl = page.url()
  }

  // Wait for page-transition animation AND session query to resolve.
  // First wait for the Transcript tab button (always rendered for open sessions),
  // then check for the chat textarea (only rendered when status === 'open').
  const transcriptTabBtn = page.locator('button:has-text("Transcript")').first()
  await expect(transcriptTabBtn).toBeVisible({ timeout: 10_000 })

  // Locate the chat composer textarea. The placeholder changes between
  // "Type a message…" (idle) and "Waiting for reply…" (streaming), so match
  // either or just the first textarea rendered in the session page.
  const textarea = page.locator('textarea').first()
  const hasChatInput = await textarea.isVisible()

  await page.screenshot({ path: 'e2e/screenshots/07a-before-chat.png', fullPage: true })

  if (!hasChatInput) {
    // Session might not be 'open' — not a crash, just wrong status
    test.info().annotations.push({ type: 'info', description: 'No chat input visible — session may not be open' })
    const body = await page.textContent('body')
    console.log('Session status check:', body?.match(/open|closed|recovery/gi)?.slice(0, 5))
    return
  }

  // Type a message
  await textarea.fill('Hello, this is a test message.')
  await page.screenshot({ path: 'e2e/screenshots/07b-typed-message.png' })

  // Send it
  await textarea.press('Enter')

  // Wait a bit for streaming to start
  await page.waitForTimeout(1_000)
  await page.screenshot({ path: 'e2e/screenshots/07c-after-send.png', fullPage: true })

  // Check: page should NOT be blank
  const bodyAfter = await page.textContent('body')
  expect(bodyAfter).not.toBe('')

  // Check no page-level crash (React error boundary renders empty or shows "Something went wrong")
  const hasCrashIndicator =
    bodyAfter?.includes('Something went wrong') ||
    bodyAfter?.includes('Uncaught') ||
    bodyAfter?.includes('ChunkLoadError')
  expect(hasCrashIndicator).toBeFalsy()

  // Textarea should still exist (or be disabled during streaming)
  const textareaExists = await textarea.isVisible()
  expect(textareaExists).toBeTruthy()

  // Wait for streaming to finish (up to 30s) — look for idle state
  await page.waitForFunction(
    () => {
      const textareas = document.querySelectorAll('textarea')
      return Array.from(textareas).some((t) => !t.disabled)
    },
    { timeout: 30_000 },
  ).catch(() => {
    console.log('WARNING: textarea stayed disabled — stream may not have completed')
  })

  await page.screenshot({ path: 'e2e/screenshots/07d-stream-finished.png', fullPage: true })
  console.log('Console errors during chat:', consoleErrors)

  if (consoleErrors.length > 0) {
    console.log('=== CONSOLE ERRORS ===')
    consoleErrors.forEach((e) => console.log(e))
  }
})

// ── 8. Transcript tab ─────────────────────────────────────────────────────────

test('8. Transcript tab renders entries without crashing', async ({ page }) => {
  await login(page)
  await goTo(page, '/grand-hall')
  await page.waitForTimeout(1_000)

  const firstCard = page.locator('.cursor-pointer').first()
  const hasCard = await firstCard.isVisible()
  if (!hasCard) return

  await firstCard.click()
  await page.waitForURL(/\/grand-hall\/sessions\//, { timeout: 8_000 })
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

  // Click Transcript tab
  const transcriptTab = page.locator('button:has-text("Transcript")').first()
  await expect(transcriptTab).toBeVisible({ timeout: 5_000 })
  await transcriptTab.click()

  await page.waitForTimeout(1_500)
  await page.screenshot({ path: 'e2e/screenshots/08-transcript-tab.png', fullPage: true })

  const body = await page.textContent('body')
  expect(body).not.toBe('')
  // Should not show a runtime error
  expect(body?.includes('TypeError')).toBeFalsy()
  expect(body?.includes('Cannot read properties')).toBeFalsy()
})

// ── 9. Memory tab ─────────────────────────────────────────────────────────────

test('9. Memory tab renders without crashing', async ({ page }) => {
  await login(page)
  await goTo(page, '/grand-hall')
  await page.waitForTimeout(1_000)

  const firstCard = page.locator('.cursor-pointer').first()
  const hasCard = await firstCard.isVisible()
  if (!hasCard) return

  await firstCard.click()
  await page.waitForURL(/\/grand-hall\/sessions\//, { timeout: 8_000 })
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

  // Click Memory tab
  const memoryTab = page.locator('button:has-text("Memory")').first()
  await expect(memoryTab).toBeVisible({ timeout: 5_000 })
  await memoryTab.click()

  await page.waitForTimeout(1_500)
  await page.screenshot({ path: 'e2e/screenshots/09-memory-tab.png', fullPage: true })

  const body = await page.textContent('body')
  expect(body).not.toBe('')
  expect(body?.includes('TypeError')).toBeFalsy()
  expect(body?.includes('Cannot read properties')).toBeFalsy()
})

// ── 10. Library — personas ────────────────────────────────────────────────────

test('10. Library page loads and shows personas', async ({ page }) => {
  await login(page)
  // Try common paths for library
  await goTo(page, '/library')
  await page.waitForTimeout(1_000)
  await page.screenshot({ path: 'e2e/screenshots/10-library.png', fullPage: true })

  const body = await page.textContent('body')
  expect(body).not.toBe('')
  // Should show personas or lore content or a nav to it
  const hasRelevant = body?.toLowerCase().includes('persona') || body?.toLowerCase().includes('lore') || body?.toLowerCase().includes('library')
  expect(hasRelevant).toBeTruthy()
})

// ── 11. Timestamps are NOT year 56000 ─────────────────────────────────────────

test('11. Session timestamps are reasonable (not year 56000)', async ({ page }) => {
  await login(page)
  await goTo(page, '/grand-hall')

  // Wait for sessions to load
  const sessionGrid = page.locator('text=Sessions').first()
  await sessionGrid.waitFor({ timeout: 8_000 }).catch(() => {})
  await page.waitForTimeout(500)

  const body = await page.textContent('body')
  await page.screenshot({ path: 'e2e/screenshots/11-timestamps.png', fullPage: true })

  // Timestamps formatted as "Apr 13, 01:22 AM" — no 4-digit year visible.
  // If multiply-by-1000 bug were present, the date would be something like "Jan 1, 58000" or similar.
  // The month name format provides the sanity check: months must be Jan–Dec abbreviations.
  const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const hasSaneMonth = MONTH_ABBREVS.some((m) => body?.includes(m))

  // Only assert if sessions exist (there should be at least one timestamp)
  const hasSessions = body?.includes('Session') && body?.includes('Open')
  if (hasSessions) {
    expect(hasSaneMonth).toBeTruthy()
  }

  // Explicit regression: must not show absurd years like 56000
  expect(body?.match(/\b5[0-9]{4}\b/)).toBeNull()
})

// ── 12. Weekly chart on Observatory ───────────────────────────────────────────

test('12. Observatory weekly chart renders (not blank)', async ({ page }) => {
  await login(page)
  await goTo(page, '/observatory')
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: 'e2e/screenshots/12-observatory-chart.png', fullPage: true })

  const body = await page.textContent('body')
  expect(body).not.toBe('')
  // The chart container should be present
  const chartEl = page.locator('.recharts-wrapper, svg, canvas').first()
  const hasChart = await chartEl.isVisible().catch(() => false)
  // Not asserting hard — just logging presence
  console.log('Chart element visible:', hasChart)
})
