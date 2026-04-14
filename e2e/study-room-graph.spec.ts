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

test.describe('Study Room — Graph facet', () => {
  test('Graph facet tab renders and shows node list or empty state', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/graph')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const header = page.locator('text=Graph')
    await expect(header.first()).toBeVisible()

    const nodeList = page.locator('[data-testid="graph-node-list"]')
    const emptyState = page.locator('text=No graph nodes recorded')
    const unsupported = page.locator('text=Graph inspection unavailable')

    const hasNodes = await nodeList.isVisible().catch(() => false)
    const isEmpty = await emptyState.isVisible().catch(() => false)
    const isUnsupported = await unsupported.isVisible().catch(() => false)

    expect(hasNodes || isEmpty || isUnsupported).toBeTruthy()

    await page.screenshot({
      path: 'e2e/screenshots/study-graph-facet.png',
      fullPage: true,
    })
  })

  test('Node card click opens drawer and updates URL', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/graph')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const cards = page.locator('[data-testid="graph-node-card"]')
    if ((await cards.count()) > 0) {
      await cards.first().click()
      await page.waitForTimeout(500)

      expect(page.url()).toContain('node_ref=')

      const drawer = page.locator('[data-testid="graph-node-drawer"]')
      await expect(drawer).toBeVisible()

      await page.screenshot({
        path: 'e2e/screenshots/study-graph-node-drawer.png',
        fullPage: true,
      })
    }
  })

  test('Edge target click drills into new node', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/graph')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const cards = page.locator('[data-testid="graph-node-card"]')
    if ((await cards.count()) > 0) {
      await cards.first().click()
      await page.waitForTimeout(600)

      const edgeTargets = page.locator('[data-testid="graph-edge-target"]')
      if ((await edgeTargets.count()) > 0) {
        const beforeUrl = page.url()
        await edgeTargets.first().click()
        await page.waitForTimeout(500)

        const afterUrl = page.url()
        expect(afterUrl).toContain('node_ref=')
        expect(afterUrl).not.toBe(beforeUrl)

        const drawer = page.locator('[data-testid="graph-node-drawer"]')
        await expect(drawer).toBeVisible()
      }
    }
  })

  test('Drawer closes on backdrop click and clears node_ref from URL', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/graph')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const cards = page.locator('[data-testid="graph-node-card"]')
    if ((await cards.count()) > 0) {
      await cards.first().click()
      await page.waitForTimeout(500)

      const backdrop = page.locator('[data-testid="graph-drawer-backdrop"]')
      await backdrop.click({ position: { x: 10, y: 10 } })
      await page.waitForTimeout(400)

      expect(page.url()).not.toContain('node_ref=')
    }
  })

  test('Stale node_ref in URL shows error state without crashing', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/graph?node_ref=nonexistent%3A999999')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(1200)

    const drawer = page.locator('[data-testid="graph-node-drawer"]')
    await expect(drawer).toBeVisible()

    const unavailable = page.locator('[data-testid="graph-node-unavailable"]')
    const unsupported = page.locator('[data-testid="graph-node-unsupported"]')
    const genericError = page.locator('[data-testid="graph-node-error"]')

    const hasError =
      (await unavailable.isVisible().catch(() => false)) ||
      (await unsupported.isVisible().catch(() => false)) ||
      (await genericError.isVisible().catch(() => false))

    expect(hasError).toBeTruthy()

    await page.screenshot({
      path: 'e2e/screenshots/study-graph-stale-node.png',
      fullPage: true,
    })
  })
})
