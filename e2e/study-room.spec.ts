import { expect, test, type Page } from '@playwright/test'

const TOKEN = process.env.E2E_TOKEN ?? 'mcw-dev-local-token'

async function login(page: Page) {
  await page.goto('/')
  const tokenInput = page.locator('input[type="password"], input[placeholder*="token" i]').first()
  await tokenInput.waitFor({ state: 'visible', timeout: 10_000 })
  await tokenInput.fill(TOKEN)
  const submitBtn = page
    .locator('button[type="submit"], button:has-text("Login"), button:has-text("Enter")')
    .first()
  await submitBtn.click()
  await tokenInput.waitFor({ state: 'hidden', timeout: 10_000 })
}

test.describe('Study Room — Episode trace links & Settlement expansion', () => {
  test('Episodes facet renders trace chips (link or legacy badge)', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/episodes')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const traceLinks = page.locator('[data-testid="episode-trace-link"]')
    const legacyBadges = page.locator('[data-testid="episode-trace-legacy"]')
    const totalChips = (await traceLinks.count()) + (await legacyBadges.count())

    expect(totalChips).toBeGreaterThan(0)

    const linkCount = await traceLinks.count()
    if (linkCount > 0) {
      const href = await traceLinks.first().getAttribute('href')
      expect(href).toContain('/study/')
      expect(href).toContain('retrieval-trace')
      expect(href).toContain('request_id=')
    }

    const legacyCount = await legacyBadges.count()
    if (legacyCount > 0) {
      await expect(legacyBadges.first()).toHaveText('legacy · no trace')
      await expect(legacyBadges.first()).toHaveCSS('cursor', 'not-allowed')
    }

    await page.screenshot({
      path: 'e2e/screenshots/study-episodes-trace-chips.png',
      fullPage: true,
    })
  })

  test('Episode trace link navigates to Retrieval Trace facet', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/episodes')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const traceLink = page.locator('[data-testid="episode-trace-link"]').first()
    if ((await traceLink.count()) > 0) {
      await traceLink.click()
      await page.waitForURL(/retrieval-trace/, { timeout: 10_000 })
      expect(page.url()).toContain('retrieval-trace')
      expect(page.url()).toContain('request_id=')

      await page.screenshot({
        path: 'e2e/screenshots/study-episodes-trace-navigation.png',
        fullPage: true,
      })
    }
  })

  test('Settlements facet shows expandable Produced Episodes section', async ({ page }) => {
    await login(page)

    await page.goto('/study/rp%3Aalice/episodes')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(600)

    await page.goto('/study/rp%3Aalice/settlements')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const toggleButtons = page.locator('[data-testid="settlement-episodes-toggle"]')
    const toggleCount = await toggleButtons.count()
    expect(toggleCount).toBeGreaterThan(0)

    await expect(toggleButtons.first()).toContainText('Produced Episodes (current window)')

    const episodesList = page.locator('[data-testid="settlement-episodes-list"]')
    expect(await episodesList.count()).toBe(0)

    await toggleButtons.first().click()
    await page.waitForTimeout(400)

    await page.screenshot({
      path: 'e2e/screenshots/study-settlements-expanded.png',
      fullPage: true,
    })

    await toggleButtons.first().click()
    await page.waitForTimeout(400)

    await page.screenshot({
      path: 'e2e/screenshots/study-settlements-collapsed.png',
      fullPage: true,
    })
  })
})

test.describe('Study Room — Retrieval Trace facet', () => {
  test('Recent requests picker shows when no request_id', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/retrieval-trace')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const header = page.locator('text=Retrieval Trace')
    await expect(header.first()).toBeVisible()

    const noRequests = page.locator('text=No requests found for this agent')
    const requestButtons = page.locator('button:has(code)')

    const hasEmptyState = (await noRequests.count()) > 0
    const hasItems = (await requestButtons.count()) > 0
    expect(hasEmptyState || hasItems).toBe(true)

    if (hasItems) {
      const firstBtn = requestButtons.first()
      const timeEl = firstBtn.locator('time')
      expect(await timeEl.count()).toBeGreaterThan(0)
    }

    await page.screenshot({
      path: 'e2e/screenshots/study-retrieval-picker.png',
      fullPage: true,
    })
  })

  test('Selecting a recent request navigates to trace detail', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/retrieval-trace')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const requestButtons = page.locator('button:has(code)')

    if ((await requestButtons.count()) > 0) {
      await requestButtons.first().click()
      await page.waitForURL(/request_id=/, { timeout: 10_000 })
      expect(page.url()).toContain('request_id=')
      expect(page.url()).toContain('retrieval-trace')

      await page.waitForTimeout(600)

      const backLink = page.locator('text=← Recent Requests')
      await expect(backLink.first()).toBeVisible()

      const noRetrieval = page.locator('text=No retrieval was captured for this request')
      const traceContent = page.locator('text=Query')
      const hasNull = (await noRetrieval.count()) > 0
      const hasTrace = (await traceContent.count()) > 0
      expect(hasNull || hasTrace).toBe(true)

      await page.screenshot({
        path: 'e2e/screenshots/study-retrieval-detail.png',
        fullPage: true,
      })
    }
  })

  test('retrieval:null shows dedicated empty state', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/retrieval-trace?request_id=nonexistent-request-for-test')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const backLink = page.locator('text=← Recent Requests')
    await expect(backLink.first()).toBeVisible()

    const requestIdCode = page.locator('code:has-text("nonexistent-request-for-test")')
    await expect(requestIdCode.first()).toBeVisible()

    await page.screenshot({
      path: 'e2e/screenshots/study-retrieval-null-state.png',
      fullPage: true,
    })
  })
})
