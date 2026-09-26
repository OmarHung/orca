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
import { getTerminalContent } from './helpers/terminal-pane-identity'

const LABEL = 'web: dev'
// Stays alive like a dev server, so the run is still active when Debug is pressed.
const SERVER = 'console.log("server-up")\nsetInterval(() => {}, 1000)\n'

/**
 * Waits until the server has printed its start marker as the latest output, so a stop reaches a
 * running program rather than a command line the shell has not started yet.
 */
// The PTY transcript keeps cursor-movement escapes after the last printed text.
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g')

async function waitForServerUp(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        (await getTerminalContent(page, 20_000))
          .replace(ANSI_ESCAPE, '')
          .trimEnd()
          .endsWith('server-up'),
      { timeout: 30_000 }
    )
    .toBe(true)
}

function explorerRow(page: Page, name: string) {
  return page
    .locator('[data-orca-explorer-shell] [data-file-explorer-row]')
    .filter({ has: page.locator('[data-file-explorer-row-name]').getByText(name, { exact: true }) })
}

test('one run configuration never runs and debugs at the same time', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(240_000)
  const fixture = createGoldenWorktree(testRepoPath, 'run-debug-exclusive')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const root = fixture.worktreePath
  writeFileSync(path.join(root, 'server.js'), SERVER)
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'web', private: true, scripts: { dev: 'node server.js' } })
  )
  writeFileSync(path.join(root, 'package-lock.json'), '{}')

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, root)
  await orcaPage.evaluate(() => window.__store?.getState().showRightSidebarFiles())
  await explorerRow(orcaPage, 'package.json').click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: `Run '${LABEL}'` }).click()

  const runControls = orcaPage.getByTestId('run-configurations-session')
  const runButton = orcaPage.getByTestId('run-configurations-launch')
  const debugButton = orcaPage.getByTestId('run-configurations-debug')
  const debugControls = orcaPage.getByTestId('run-debug-session')
  await expect(runControls).toHaveAttribute('data-run-status', 'running', { timeout: 30_000 })
  await waitForServerUp(orcaPage)
  await expect(runButton).toHaveCount(0)
  await expect(debugButton).toHaveAccessibleName(`Stop and debug '${LABEL}'`)

  // Cancelling keeps the run.
  await debugButton.click()
  const runningDialog = orcaPage.getByRole('dialog').filter({ hasText: `'${LABEL}' is running` })
  await expect(runningDialog).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('stop-and-debug-confirm.png') })
  await runningDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(runningDialog).toHaveCount(0)
  await expect(runControls).toHaveAttribute('data-run-status', 'running')
  await expect(debugControls).toHaveCount(0)

  // Confirming stops the run, then debugs it.
  await debugButton.click()
  await runningDialog.getByRole('button', { name: 'Stop and Debug' }).click()
  await expect(runControls).not.toHaveAttribute('data-run-status', 'running', { timeout: 30_000 })
  // Why the long timeout: the first debug session downloads and extracts js-debug.
  await expect(debugControls).toBeVisible({ timeout: 120_000 })
  await expect(debugButton).toHaveCount(0)
  await expect(runButton).toHaveAccessibleName(`Stop debugging and run '${LABEL}'`)
  await orcaPage.screenshot({ path: testInfo.outputPath('debugging.png') })

  // Run while debugging asks too, then stops the debug session and runs.
  await runButton.click()
  const debuggingDialog = orcaPage
    .getByRole('dialog')
    .filter({ hasText: `'${LABEL}' is being debugged` })
  await debuggingDialog.getByRole('button', { name: 'Stop and Run' }).click()
  await expect(debugControls).toHaveCount(0, { timeout: 30_000 })
  await expect(runControls).toHaveAttribute('data-run-status', 'running', { timeout: 30_000 })
  await waitForServerUp(orcaPage)
  await expect(debugButton).toHaveAccessibleName(`Stop and debug '${LABEL}'`)

  await runControls.getByTestId('run-stop').click()
  await expect(runControls).not.toHaveAttribute('data-run-status', 'running', { timeout: 30_000 })
  await expect(runButton).toHaveAccessibleName(`Run '${LABEL}'`)
})
