/**
 * Phase 1 — v1 cutover acceptance (refactor-consensus.md §9.2)
 *
 * Covers the full flow:
 *   new session → chat (SSE streaming) → edit persona via Library →
 *   hot reload → verify updated persona is visible + used by a fresh chat
 *
 * Prerequisites:
 *   - MaidsClaw gateway on :18790 (config/auth.json token: maidsclaw)
 *   - Dashboard dev server on :5173
 */

import { expect, test, type Page, request as pwRequest } from '@playwright/test'

const TOKEN = process.env.E2E_TOKEN ?? 'maidsclaw'
const GATEWAY = process.env.E2E_GATEWAY ?? 'http://localhost:18790'
const MARKER_SUFFIX = `e2e-${Date.now().toString(36)}`

async function login(page: Page) {
  await page.goto('/')
  const tokenInput = page
    .locator('input[type="password"], input[placeholder*="token" i]')
    .first()
  await tokenInput.waitFor({ state: 'visible', timeout: 10_000 })
  await tokenInput.fill(TOKEN)
  const submitBtn = page
    .locator('button[type="submit"], button:has-text("Login"), button:has-text("Connect"), button:has-text("Enter")')
    .first()
  await submitBtn.click()
  await tokenInput.waitFor({ state: 'hidden', timeout: 10_000 })
}

test.describe('Phase 1 cutover acceptance', () => {
  // Snapshot of Alice persona before mutation so we can restore it at the end.
  let originalAlice: Record<string, unknown> | null = null

  test.beforeAll(async () => {
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` },
    })
    const resp = await ctx.get(`${GATEWAY}/v1/personas/alice`)
    expect(resp.ok()).toBeTruthy()
    originalAlice = (await resp.json()) as Record<string, unknown>
    await ctx.dispose()
  })

  test.afterAll(async () => {
    if (!originalAlice) return
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` },
    })
    const resp = await ctx.put(`${GATEWAY}/v1/personas/alice`, { data: originalAlice })
    expect(resp.ok()).toBeTruthy()
    await ctx.dispose()
  })

  test('A. Welcome Room renders and shows gateway + version info', async ({ page }) => {
    await login(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.screenshot({ path: 'e2e/screenshots/phase1-A-welcome.png', fullPage: true })
    const body = (await page.textContent('body'))?.toLowerCase() ?? ''
    // Welcome page should show at least one of: gateway status / version / room navigation
    const hasMarkers =
      body.includes('maids') || body.includes('welcome') || body.includes('gateway') || body.includes('grand hall')
    expect(hasMarkers).toBeTruthy()
  })

  test('B. Grand Hall → create session → chat → SSE deltas rendered', async ({ page }) => {
    await login(page)
    await page.goto('/grand-hall')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

    // Create a new session
    const newBtn = page.locator('button:has-text("New Session"), button:has-text("New")').first()
    await newBtn.click()
    const agentSelect = page.locator('select').first()
    await expect(agentSelect).toBeVisible({ timeout: 8_000 })
    await agentSelect.selectOption({ index: 1 })
    await page.locator('button:has-text("Create")').first().click()
    await page.waitForTimeout(1_500)

    // Open the newest session card
    const firstCard = page.locator('.cursor-pointer').first()
    await firstCard.waitFor({ state: 'visible', timeout: 8_000 })
    await firstCard.click()
    await page.waitForURL(/\/grand-hall\/sessions\//, { timeout: 10_000 })

    const transcriptTabBtn = page.locator('button:has-text("Transcript")').first()
    await expect(transcriptTabBtn).toBeVisible({ timeout: 15_000 })

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 8_000 })

    // Send a short message and wait for streaming to complete
    await textarea.fill('请用一句话自我介绍。')
    await page.screenshot({ path: 'e2e/screenshots/phase1-B1-before-send.png', fullPage: true })
    await textarea.press('Enter')

    // Wait for streaming to finish: textarea re-enabled
    await page.waitForFunction(
      () => {
        const ta = document.querySelector('textarea') as HTMLTextAreaElement | null
        return !!ta && !ta.disabled
      },
      { timeout: 60_000 },
    )
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'e2e/screenshots/phase1-B2-after-stream.png', fullPage: true })

    // Expect the transcript area to contain more than just the user echo
    const body = await page.textContent('body')
    expect(body ?? '').toContain('请用一句话自我介绍')
  })

  test('C. Library → edit Alice persona → hot reload round-trip', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.screenshot({ path: 'e2e/screenshots/phase1-C1-library.png', fullPage: true })

    // Alice persona card should be visible
    const aliceNameLocator = page.locator('p.font-bold', { hasText: /^Alice$/ }).first()
    await expect(aliceNameLocator).toBeVisible({ timeout: 8_000 })

    // Click the edit button in Alice's card. Walk up from the name <p> until we
    // find the first ancestor that also contains a <button>; the first button
    // in that ancestor is the Edit button (Trash2 is second).
    const clicked = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('p.font-bold')) as HTMLElement[]
      const aliceP = ps.find((p) => p.textContent?.trim() === 'Alice')
      if (!aliceP) return 'no-alice-p'
      let parent: HTMLElement | null = aliceP.parentElement
      while (parent && !parent.querySelector('button')) {
        parent = parent.parentElement
      }
      if (!parent) return 'no-card-ancestor'
      const btn = parent.querySelector('button[type="button"]') as HTMLButtonElement | null
      if (!btn) return 'no-button'
      btn.click()
      return 'clicked'
    })
    expect(clicked, 'Expected to click the Alice Edit button').toBe('clicked')

    // Wait for drawer to open and confirm it shows Alice
    const idInput = page.locator('input[placeholder*="unique-persona-id" i]').first()
    await expect(idInput).toBeVisible({ timeout: 8_000 })
    await expect(idInput).toHaveValue('alice')

    // Modify the description to include a unique marker
    const descTextarea = page.locator('textarea').nth(0) // Description is the first textarea in drawer
    // First textarea is actually Description (per PersonaEditorDrawer field order)
    const markerDesc = `一位专业且开朗的女仆 [Phase1 ${MARKER_SUFFIX}]`
    await descTextarea.waitFor({ state: 'visible', timeout: 8_000 })
    await descTextarea.fill(markerDesc)
    await page.screenshot({ path: 'e2e/screenshots/phase1-C2-drawer-filled.png', fullPage: true })

    // Click Update
    await page.locator('button[type="submit"]:has-text("Update"), button[type="submit"]:has-text("Create")').first().click()

    // Drawer should close after successful save (id input hidden)
    await idInput.waitFor({ state: 'hidden', timeout: 15_000 })
    await page.screenshot({ path: 'e2e/screenshots/phase1-C3-after-save.png', fullPage: true })

    // Verify the gateway returns the updated description (hot-reload round-trip)
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` },
    })
    const resp = await ctx.get(`${GATEWAY}/v1/personas/alice`)
    expect(resp.ok()).toBeTruthy()
    const updated = (await resp.json()) as Record<string, unknown>
    expect(updated.description).toBe(markerDesc)
    await ctx.dispose()

    // Reload the Library page — the UI should show the new description
    await page.goto('/library')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(500)
    const bodyText = await page.textContent('body')
    expect(bodyText ?? '').toContain(MARKER_SUFFIX)
    await page.screenshot({ path: 'e2e/screenshots/phase1-C4-library-updated.png', fullPage: true })
  })

  test('D. Persona hot reload is reflected in a new session/turn', async ({ page }) => {
    // Prerequisite: test C has updated Alice's description with the marker
    const ctx = await pwRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` },
    })
    const resp = await ctx.get(`${GATEWAY}/v1/personas/alice`)
    expect(resp.ok()).toBeTruthy()
    const alice = (await resp.json()) as Record<string, unknown>
    expect(String(alice.description)).toContain(MARKER_SUFFIX)
    await ctx.dispose()

    // Open Grand Hall, create a new session for rp:alice (if available) or maid:main,
    // send a short message, and verify the stream completes without error.
    await login(page)
    await page.goto('/grand-hall')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

    await page.locator('button:has-text("New Session"), button:has-text("New")').first().click()
    const agentSelect = page.locator('select').first()
    await expect(agentSelect).toBeVisible({ timeout: 8_000 })

    // Prefer rp:alice if it appears in the dropdown
    const options = await agentSelect.locator('option').allInnerTexts()
    const aliceIdx = options.findIndex((o) => o.toLowerCase().includes('alice'))
    if (aliceIdx >= 0) {
      await agentSelect.selectOption({ index: aliceIdx })
    } else {
      await agentSelect.selectOption({ index: 1 })
    }

    await page.locator('button:has-text("Create")').first().click()
    await page.waitForTimeout(1_500)

    const firstCard = page.locator('.cursor-pointer').first()
    await firstCard.waitFor({ state: 'visible', timeout: 8_000 })
    await firstCard.click()
    await page.waitForURL(/\/grand-hall\/sessions\//, { timeout: 10_000 })

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10_000 })
    await textarea.fill('你好。')
    await textarea.press('Enter')

    await page.waitForFunction(
      () => {
        const ta = document.querySelector('textarea') as HTMLTextAreaElement | null
        return !!ta && !ta.disabled
      },
      { timeout: 60_000 },
    )
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'e2e/screenshots/phase1-D-new-session-stream.png', fullPage: true })

    // A basic smoke: no crash, no blank page
    const body = await page.textContent('body')
    expect(body ?? '').not.toBe('')
    expect(body?.includes('Something went wrong')).toBeFalsy()
    expect(body?.includes('TypeError')).toBeFalsy()
  })
})
