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

test.describe('Study Room — P0 gap-doc guarantees', () => {
  // SR-D-3: /study/:agentId with no facet path segment must land on Episodes.
  test('default facet is Episodes when URL omits facet segment', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(500)

    expect(page.url()).toContain('/study/rp')

    const episodesHeader = page.locator('text=/^Episodes$/').first()
    await expect(episodesHeader).toBeVisible({ timeout: 10_000 })

    const coreBlocksHeader = page.locator('text=/^Core Blocks$/')
    await expect(coreBlocksHeader).not.toBeVisible()
  })

  // SR-Retrieve-F-3: Retrieval-trace Walk sub-view must render Seeds /
  // Visited Steps / Final Selection sections when a request has navigator state.
  test('retrieval-trace Walk sub-tab renders seeds, steps, and final selection', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/retrieval-trace')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const requestButton = page.locator('[data-testid="retrieval-request-pick"]').first()
    if ((await requestButton.count()) === 0) {
      test.skip(true, 'no recent requests available for seeding walk view')
      return
    }
    await requestButton.click()
    await page.waitForURL(/request_id=/, { timeout: 10_000 })
    await page.waitForTimeout(600)

    const walkTab = page.locator('[data-testid="retrieval-subtab-walk"]')
    await expect(walkTab).toBeVisible()
    await walkTab.click()
    await page.waitForTimeout(400)

    const walkNotRecorded = page.locator('text=No walk recorded')
    if (await walkNotRecorded.isVisible().catch(() => false)) {
      test.skip(true, 'selected request has no navigator walk')
      return
    }

    const seedsHeader = page.locator('text=/Seeds/i').first()
    const stepsHeader = page.locator('text=/Visited Steps/i').first()
    const finalHeader = page.locator('text=/Final Selection/i').first()
    await expect(seedsHeader).toBeVisible()
    await expect(stepsHeader).toBeVisible()
    await expect(finalHeader).toBeVisible()
  })

  // SR-Graph-F-4 / gap §4.6: memory-layer edges with cognition-linked relations
  // must expose a 🧠 jump button that links to the cognition facet.
  test('graph-edge cognition jump button routes to cognition facet', async ({ page }) => {
    await login(page)
    await page.goto('/study/rp%3Aalice/graph')
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(800)

    const cards = page.locator('[data-testid="graph-node-card"]')
    const cardCount = await cards.count()
    if (cardCount === 0) {
      test.skip(true, 'no graph nodes available for edge traversal')
      return
    }

    // Walk up to 5 nodes looking for one that exposes a cognition jump button.
    let jumpButton = page.locator('[data-testid="graph-edge-cognition-jump"]').first()
    for (let i = 0; i < Math.min(cardCount, 5); i += 1) {
      await cards.nth(i).click()
      await page.waitForTimeout(500)
      if ((await jumpButton.count()) > 0) break
      const backdrop = page.locator('[data-testid="graph-drawer-backdrop"]')
      await backdrop.click({ position: { x: 10, y: 10 } }).catch(() => {})
      await page.waitForTimeout(300)
    }

    if ((await jumpButton.count()) === 0) {
      test.skip(true, 'no memory-layer cognition-linked edges on sampled nodes')
      return
    }

    // Layer grouping label must be visible when jump button is present.
    const memoryGroup = page.locator('[data-testid="graph-edge-group-memory"]')
    await expect(memoryGroup).toBeVisible()

    const href = await jumpButton.getAttribute('href')
    expect(href).toContain('/study/')
    expect(href).toContain('cognition')
    expect(href).toContain('tab=assertions')

    await jumpButton.click()
    await page.waitForURL(/\/cognition/, { timeout: 10_000 })
    expect(page.url()).toContain('/cognition')
    expect(page.url()).toContain('tab=assertions')
  })
})
