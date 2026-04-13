/**
 * Study Room state survey — captures what rp:alice memory visualization looks
 * like right now, facet by facet. Read-only; takes screenshots only.
 */
import { expect, test, type Page } from '@playwright/test'

const TOKEN = process.env.E2E_TOKEN ?? 'mcw-dev-local-token'

async function login(page: Page) {
  await page.goto('/')
  const tokenInput = page
    .locator('input[type="password"], input[placeholder*="token" i]')
    .first()
  await tokenInput.waitFor({ state: 'visible', timeout: 10_000 })
  await tokenInput.fill(TOKEN)
  const submitBtn = page
    .locator('button[type="submit"], button:has-text("Login"), button:has-text("Enter")')
    .first()
  await submitBtn.click()
  await tokenInput.waitFor({ state: 'hidden', timeout: 10_000 })
}

test('Survey: Study Room for rp:alice across all facets', async ({ page }) => {
  await login(page)

  for (const facet of [
    'core-blocks',
    'episodes',
    'narratives',
    'settlements',
    'pinned-summaries',
    'retrieval-trace',
  ] as const) {
    await page.goto(`/study/rp%3Aalice/${facet}`)
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(600)
    await page.screenshot({
      path: `e2e/screenshots/study-${facet}.png`,
      fullPage: true,
    })
  }

  // Smoke: page did not crash
  const body = await page.textContent('body')
  expect(body ?? '').not.toBe('')
})
