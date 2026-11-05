import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const LONG_NAME = `${'a_file_name_long_enough_to_scroll_sideways_'.repeat(3)}end.ts`
const VIEWPORT = '[data-slot="scroll-area-viewport"]'

function treeViewport(page: Page): Locator {
  return page.locator('[data-orca-explorer-shell]').locator(VIEWPORT).first()
}

function row(page: Page, name: string): Locator {
  return page
    .locator('[data-file-explorer-row]')
    .filter({ has: page.getByText(name, { exact: true }) })
}

function openFile(page: Page, filePath: string, relativePath: string): Promise<void> {
  return page.evaluate(
    ({ absolute, relative }) => {
      const state = window.__store!.getState()
      state.openFile({
        filePath: absolute,
        relativePath: relative,
        worktreeId: state.activeWorktreeId!,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { absolute: filePath, relative: relativePath }
  )
}

test('scrolls long file names sideways instead of cutting them short', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)
  const worktreePath = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    return Object.values(state.worktreesByRepo)
      .flat()
      .find((candidate) => candidate.id === state.activeWorktreeId)!.path
  })
  const folder = path.join(worktreePath, 'hscroll-proof')
  const relativePath = `hscroll-proof/${LONG_NAME}`
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, LONG_NAME), 'export const long = 1\n')
  const viewport = treeViewport(orcaPage)
  // Scoped to the tree: the open file's tab shows the same name.
  const name = orcaPage.locator('[data-file-explorer-row]').getByText(LONG_NAME, { exact: true })

  try {
    await expect(row(orcaPage, 'README.md')).toBeVisible({ timeout: 10_000 })
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(false)

    await openFile(orcaPage, path.join(folder, LONG_NAME), relativePath)
    await expect(name).toBeVisible({ timeout: 10_000 })
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true)
    await orcaPage.screenshot({ path: testInfo.outputPath('at-left.png') })

    // A real wheel gesture over a draggable row, which Chromium can swallow.
    await row(orcaPage, 'README.md').hover()
    await orcaPage.mouse.wheel(120, 0)
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)

    // Scrolled to the end, the whole name is inside the viewport and nothing is clipped.
    await viewport.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    const fits = await name.evaluate((label, selector) => {
      const scroller = label.closest(selector)!.getBoundingClientRect()
      const box = label.getBoundingClientRect()
      return box.right <= scroller.right && label.scrollWidth <= label.clientWidth
    }, VIEWPORT)
    expect(fits).toBe(true)
    await orcaPage.screenshot({ path: testInfo.outputPath('at-right.png') })

    // Locating a shallow file from far right brings its row's start back on screen.
    await openFile(orcaPage, path.join(worktreePath, 'README.md'), 'README.md')
    await viewport.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    await orcaPage.getByRole('button', { name: 'Locate Active File' }).click()
    await expect(row(orcaPage, 'README.md')).toHaveAttribute('data-selected', 'true')
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(0)

    // Collapsing the folder removes the long row, so the sideways scroll goes away with it.
    await row(orcaPage, 'hscroll-proof').click()
    await expect(name).toHaveCount(0)
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(false)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
