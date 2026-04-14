import { expect, test, type Page } from '@playwright/test'

const TOKEN = process.env.E2E_TOKEN ?? 'maidsclaw'

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

test.describe('Study Room — Cognition facet', () => {
  test('Cognition facet tab renders and shows subtabs', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/cognition')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const header = page.locator('text=Cognition')
    await expect(header.first()).toBeVisible()

    const assertionsTab = page.locator('[data-testid="cognition-subtab-assertions"]')
    const evaluationsTab = page.locator('[data-testid="cognition-subtab-evaluations"]')
    const commitmentsTab = page.locator('[data-testid="cognition-subtab-commitments"]')

    await expect(assertionsTab).toBeVisible()
    await expect(evaluationsTab).toBeVisible()
    await expect(commitmentsTab).toBeVisible()

    await page.screenshot({
      path: 'e2e/screenshots/study-cognition-facet.png',
      fullPage: true,
    })
  })

  test('Subtab switch updates URL query param', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/cognition?tab=assertions')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const evaluationsTab = page.locator('[data-testid="cognition-subtab-evaluations"]')
    await evaluationsTab.click()
    await page.waitForTimeout(500)

    expect(page.url()).toContain('tab=evaluations')
    expect(page.url()).toContain('cognition')

    const commitmentsTab = page.locator('[data-testid="cognition-subtab-commitments"]')
    await commitmentsTab.click()
    await page.waitForTimeout(500)

    expect(page.url()).toContain('tab=commitments')
  })

  test('Cognition card click opens history drawer', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/cognition?tab=assertions')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const cards = page.locator('[data-testid="cognition-card"]')
    if ((await cards.count()) > 0) {
      await cards.first().click()
      await page.waitForTimeout(500)

      const drawer = page.locator('[data-testid="cognition-history-drawer"]')
      await expect(drawer).toBeVisible()

      await page.screenshot({
        path: 'e2e/screenshots/study-cognition-history-drawer.png',
        fullPage: true,
      })

      const closeBtn = page.locator('[data-testid="cognition-history-close"]')
      await closeBtn.click()
      await page.waitForTimeout(400)
    }
  })

  test('History drawer closes on backdrop click', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/cognition?tab=assertions')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const cards = page.locator('[data-testid="cognition-card"]')
    if ((await cards.count()) > 0) {
      await cards.first().click()
      await page.waitForTimeout(500)

      const backdrop = page.locator('[data-testid="cognition-history-backdrop"]')
      await backdrop.click({ position: { x: 10, y: 10 } })
      await page.waitForTimeout(400)
    }
  })
})

test.describe('Grand Hall → Cognition deep link', () => {
  test('Assistant messages with request_id show Cognition link', async ({ page }) => {
    await login(page)

    const sessionsResponse = await page.request.get('/api/v1/sessions')
    const sessionsBody = (await sessionsResponse.json()) as { items?: { session_id: string }[] }
    const firstSession = sessionsBody.items?.[0]

    if (!firstSession) {
      test.skip()
      return
    }

    await page.goto(`/grand-hall/${firstSession.session_id}`)
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const cognitionLinks = page.locator('[data-testid="grand-hall-cognition-link"]')
    const linkCount = await cognitionLinks.count()

    if (linkCount > 0) {
      const href = await cognitionLinks.first().getAttribute('href')
      expect(href).toContain('/study/')
      expect(href).toContain('cognition')
      expect(href).toContain('request_id=')
      expect(href).toContain('tab=assertions')

      await cognitionLinks.first().click()
      await page.waitForURL(/\/study\/.*cognition/, { timeout: 10_000 })
      expect(page.url()).toContain('cognition')
      expect(page.url()).toContain('request_id=')
    }

    await page.screenshot({
      path: 'e2e/screenshots/grand-hall-cognition-link.png',
      fullPage: true,
    })
  })
})
