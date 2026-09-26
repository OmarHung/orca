import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const PROGRAM = 'debug_target.py'
const SOURCE = 'answer = 41\nanswer += 1\nprint(f"result={answer}")\n'

function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// Why skip: debugpy needs a local Python, and its first-use download needs network access.
test.skip(!hasPython(), 'python3 is not installed')

test('stops at a Python breakpoint and shows local variables', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = createGoldenWorktree(testRepoPath, 'debug-python')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  writeFileSync(path.join(fixture.worktreePath, PROGRAM), SOURCE)

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarTab('source-control')
    state?.setRightSidebarOpen(true)
  })
  await orcaPage.getByRole('button', { name: 'Explorer' }).click()

  const explorer = orcaPage.locator('[data-orca-explorer-shell]')
  const programRow = explorer.locator('[data-file-explorer-row]').filter({
    has: orcaPage.locator('[data-file-explorer-row-name]').getByText(PROGRAM, { exact: true })
  })
  await expect(programRow).toBeVisible({ timeout: 10_000 })
  await programRow.click()

  const editor = orcaPage.locator('.monaco-editor').first()
  await expect(editor).toContainText('answer = 41', { timeout: 25_000 })

  // Glyph margin sits left of the line numbers; click beside line 2 to toggle a breakpoint.
  const lineTwoNumber = editor.locator('.line-numbers').filter({ hasText: /^2$/ })
  const box = await lineTwoNumber.boundingBox()
  expect(box).not.toBeNull()
  await orcaPage.mouse.click(box!.x - 6, box!.y + box!.height / 2)
  await expect(editor.locator('.orca-debug-breakpoint')).toHaveCount(1)

  await programRow.click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: `Debug '${PROGRAM}'` }).click()

  const panel = orcaPage.getByTestId('debug-panel')
  await expect(panel).toBeVisible()
  const frames = panel.getByTestId('debug-frames')
  const variables = panel.getByTestId('debug-variables')
  // Why the long timeout: the first run downloads and extracts debugpy.
  await expect(frames).toContainText(`${PROGRAM}:2`, { timeout: 120_000 })
  await expect(variables).toContainText('answer')
  await expect(variables).toContainText('41')
  await expect(editor.locator('.orca-debug-execution-line')).toHaveCount(1)
  await orcaPage.screenshot({ path: testInfo.outputPath('debug-paused.png') })

  await panel.getByRole('button', { name: 'Resume Program' }).click()
  const debugConsole = panel.getByTestId('debug-console')
  await expect(debugConsole).toContainText('result=42', { timeout: 30_000 })
  await expect(panel).toContainText(`${PROGRAM} finished`, { timeout: 30_000 })
  await expect(editor.locator('.orca-debug-execution-line')).toHaveCount(0)
  await orcaPage.screenshot({ path: testInfo.outputPath('debug-finished.png') })
})
