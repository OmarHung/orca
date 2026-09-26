import type { Locator, Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

async function box(locator: Locator): Promise<{ width: number; height: number }> {
  const rect = await locator.boundingBox()
  if (!rect) {
    throw new Error('region is not visible')
  }
  return { width: rect.width, height: rect.height }
}

/** Drags a resize handle by (dx, dy) from its center. */
async function drag(page: Page, handle: Locator, dx: number, dy: number): Promise<void> {
  const rect = await handle.boundingBox()
  if (!rect) {
    throw new Error('handle is not visible')
  }
  const x = rect.x + rect.width / 2
  const y = rect.y + rect.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 5 })
  await page.mouse.up()
}

test('resizes the Debug panel regions and keeps the sizes after a reload', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.getByTestId('debug-status-toggle').click()
  const frames = orcaPage.getByTestId('debug-frames-region')
  const side = orcaPage.getByTestId('debug-side-region')
  const watches = orcaPage.getByTestId('debug-watches-region')
  await expect(frames).toBeVisible()

  const before = {
    frames: (await box(frames)).width,
    side: (await box(side)).width,
    watches: (await box(watches)).height
  }
  await drag(orcaPage, orcaPage.getByRole('separator', { name: 'Resize frames' }), 60, 0)
  await drag(
    orcaPage,
    orcaPage.getByRole('separator', { name: 'Resize console and breakpoints' }),
    -80,
    0
  )
  await drag(orcaPage, orcaPage.getByRole('separator', { name: 'Resize watches' }), 0, -30)

  const after = {
    frames: (await box(frames)).width,
    side: (await box(side)).width,
    watches: (await box(watches)).height
  }
  expect(after.frames).toBeCloseTo(before.frames + 60, -1)
  expect(after.side).toBeCloseTo(before.side + 80, -1)
  expect(after.watches).toBeCloseTo(before.watches + 30, -1)

  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  await expect(frames).toBeVisible()
  expect((await box(frames)).width).toBeCloseTo(after.frames, -1)
  expect((await box(side)).width).toBeCloseTo(after.side, -1)
  expect((await box(watches)).height).toBeCloseTo(after.watches, -1)
})
