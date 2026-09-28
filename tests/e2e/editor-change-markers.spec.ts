import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const FILE_NAME = 'settings.json'
const HEAD_LINES = [
  '{',
  '  "name": "demo",',
  '  "articles": true,',
  '  "members": true,',
  '  "campaigns": true,',
  '  "legacyCheckout": true,',
  '  "friendPrice": true,',
  '  "addons": true,',
  '  "cron": "0 1 * * *"',
  '}',
  ''
]
// Modifies "articles", deletes "legacyCheckout" and adds "betaBanner".
const EDITED_LINES = [
  '{',
  '  "name": "demo",',
  '  "articles": false,',
  '  "members": true,',
  '  "campaigns": true,',
  '  "friendPrice": true,',
  '  "addons": true,',
  '  "cron": "0 1 * * *",',
  '  "betaBanner": true',
  '}',
  ''
]

async function openEditorFile(page: Page, worktreePath: string, relativePath: string) {
  await page.evaluate(
    ({ root, rel }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (!state || !worktreeId) {
        throw new Error('no active worktree')
      }
      const separator = root.includes('\\') ? '\\' : '/'
      state.openFile({
        filePath: `${root}${separator}${rel}`,
        relativePath: rel,
        worktreeId,
        language: 'json',
        mode: 'edit'
      })
    },
    { root: worktreePath, rel: relativePath }
  )
}

async function readDraft(page: Page, filePath: string): Promise<string | undefined> {
  return page.evaluate((id) => window.__store?.getState().editorDrafts[id], filePath)
}

test('the edit view marks uncommitted edits in the gutter and rolls one back', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'change-markers')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const filePath = join(fixture.worktreePath, FILE_NAME)
  writeFileSync(filePath, HEAD_LINES.join('\n'))
  execFileSync('git', ['add', FILE_NAME], { cwd: fixture.worktreePath, stdio: 'pipe' })
  execFileSync('git', ['commit', '--no-verify', '-m', 'seed settings'], {
    cwd: fixture.worktreePath,
    stdio: 'pipe'
  })
  writeFileSync(filePath, EDITED_LINES.join('\n'))

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await openEditorFile(orcaPage, fixture.worktreePath, FILE_NAME)

  const gutter = orcaPage.locator('.margin-view-overlays')
  // "cron" gained a comma before "betaBanner", so that pair reads as one modified hunk.
  await expect(gutter.locator('.orca-change-marker-modified')).toHaveCount(3, { timeout: 30_000 })
  await expect(gutter.locator('.orca-change-marker-deleted')).toHaveCount(1)
  await expect(gutter.locator('.orca-change-marker')).toHaveCount(4)
  const nextChange = orcaPage.getByRole('button', { name: 'Next change' })
  await expect(nextChange).toBeEnabled()

  // Clicking the bar's leftmost pixels opens the HEAD preview above the change.
  await gutter
    .locator('.orca-change-marker-modified')
    .first()
    .click({ position: { x: 2, y: 4 } })
  const peek = orcaPage.locator('.orca-change-marker-peek')
  await expect(peek).toBeVisible()
  await expect(peek.getByText('Modified')).toBeVisible()
  await expect(peek.getByText('1 / 3')).toBeVisible()
  await expect(peek.locator('.orca-change-marker-original-text')).toHaveText('true')
  await expect(orcaPage.locator('.orca-change-marker-current-text')).toHaveText('false')
  await orcaPage.screenshot({ path: testInfo.outputPath('change-marker-peek.png') })

  // Why includeHidden: Monaco marks its view-zone layer aria-hidden.
  await peek.getByRole('button', { name: 'Roll back change', includeHidden: true }).click()
  await expect(peek).toBeHidden()
  await expect(gutter.locator('.orca-change-marker-modified')).toHaveCount(2)
  await expect.poll(() => readDraft(orcaPage, filePath)).toContain('"articles": true,')

  // The deletion's wedge opens a preview of the removed line; Escape closes it.
  await gutter.locator('.orca-change-marker-deleted').click({ position: { x: 2, y: 4 } })
  await expect(peek).toBeVisible()
  await expect(peek.getByText('Deleted')).toBeVisible()
  await expect(peek).toContainText('legacyCheckout')
  await orcaPage.screenshot({ path: testInfo.outputPath('change-marker-deleted-peek.png') })
  await orcaPage.locator('.monaco-editor .view-line').first().click()
  await orcaPage.keyboard.press('Escape')
  await expect(peek).toBeHidden()

  // The header switch hides the gutter and brings it back.
  const toggle = orcaPage.getByTestId('change-markers-toggle')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(gutter.locator('.orca-change-marker')).toHaveCount(0)
  await toggle.click()
  await expect(gutter.locator('.orca-change-marker')).toHaveCount(3)
})
