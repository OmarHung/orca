import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const PROGRAM = 'app.js'
const SOURCE = 'let answer = 41\nanswer += 1\nconsole.log("answer=" + answer)\n'

function explorerRow(page: Page, name: string) {
  return page
    .locator('[data-orca-explorer-shell] [data-file-explorer-row]')
    .filter({ has: page.locator('[data-file-explorer-row-name]').getByText(name, { exact: true }) })
}

async function expectPausedOnLineTwo(page: Page): Promise<void> {
  const panel = page.getByTestId('debug-panel')
  // Why the long timeout: the first run downloads and extracts js-debug.
  await expect(panel.getByTestId('debug-frames')).toContainText(`${PROGRAM}:2`, {
    timeout: 120_000
  })
  await expect(panel.getByTestId('debug-variables')).toContainText('answer')
  await expect(panel.getByTestId('debug-variables')).toContainText('41')
  await panel.getByRole('button', { name: 'Resume Program' }).click()
  await expect(panel.getByTestId('debug-console')).toContainText('answer=42', { timeout: 30_000 })
}

test('debugs a JavaScript file and an npm script with js-debug', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(240_000)
  const fixture = createGoldenWorktree(testRepoPath, 'debug-node')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const root = fixture.worktreePath
  writeFileSync(path.join(root, PROGRAM), SOURCE)
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'web', private: true, scripts: { dev: `node ${PROGRAM}` } })
  )
  writeFileSync(path.join(root, 'package-lock.json'), '{}')

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, root)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarTab('source-control')
    state?.setRightSidebarOpen(true)
  })
  await orcaPage.getByRole('button', { name: 'Explorer' }).click()
  await explorerRow(orcaPage, PROGRAM).click()
  const editor = orcaPage.locator('.monaco-editor').first()
  await expect(editor).toContainText('answer = 41', { timeout: 25_000 })

  const lineTwo = await editor.locator('.line-numbers').filter({ hasText: /^2$/ }).boundingBox()
  expect(lineTwo).not.toBeNull()
  await orcaPage.mouse.click(lineTwo!.x - 6, lineTwo!.y + lineTwo!.height / 2)
  await expect(editor.locator('.orca-debug-breakpoint')).toHaveCount(1)

  // The current file, from the tab bar.
  await orcaPage.getByTestId('node-debug-file').click()
  await expectPausedOnLineTwo(orcaPage)
  await orcaPage.screenshot({ path: testInfo.outputPath('node-file-debugged.png') })

  // A package.json script: js-debug follows the node process npm starts.
  await explorerRow(orcaPage, 'package.json').click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: "Debug 'web: dev'" }).click()
  await expectPausedOnLineTwo(orcaPage)
  await orcaPage.screenshot({ path: testInfo.outputPath('node-script-debugged.png') })
})
