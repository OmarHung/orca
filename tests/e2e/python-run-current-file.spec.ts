import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal-pane-identity'

const PROGRAM = path.join('scripts', 'where.py')
// Why arithmetic: the printed marker must not match the echoed command line.
const SOURCE = 'import sys\nprint("prefix-" + str(6 * 7) + ":" + sys.prefix)\n'

function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

test.skip(!hasPython(), 'python3 is not installed')

test('runs and debugs the current Python file with the project venv, or a chosen interpreter', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = createGoldenWorktree(testRepoPath, 'python-run')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const root = fixture.worktreePath
  execFileSync('python3', ['-m', 'venv', '.venv'], { cwd: root, stdio: 'pipe' })
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  writeFileSync(path.join(root, PROGRAM), SOURCE)
  const venvPrefix = realpathSync(path.join(root, '.venv'))

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, root)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarTab('source-control')
    state?.setRightSidebarOpen(true)
  })
  await orcaPage.getByRole('button', { name: 'Explorer' }).click()
  const explorer = orcaPage.locator('[data-orca-explorer-shell]')
  await explorer
    .locator('[data-file-explorer-row]')
    .filter({
      has: orcaPage.locator('[data-file-explorer-row-name]').getByText('scripts', { exact: true })
    })
    .click()
  await explorer
    .locator('[data-file-explorer-row]')
    .filter({
      has: orcaPage.locator('[data-file-explorer-row-name]').getByText('where.py', { exact: true })
    })
    .click()
  await expect(orcaPage.locator('.monaco-editor').first()).toContainText('sys.prefix', {
    timeout: 25_000
  })

  // Auto-detection picks the project's .venv.
  const trigger = orcaPage.getByTestId('python-interpreter-trigger')
  await expect(trigger).toContainText('(.venv)', { timeout: 20_000 })
  await orcaPage.getByTestId('python-run-file').click()
  const controls = orcaPage.getByTestId('python-run-controls')
  await expect(controls).toHaveAttribute('data-run-status', 'succeeded', { timeout: 30_000 })
  await expect
    .poll(async () => getTerminalContent(orcaPage, 20_000), { timeout: 20_000 })
    .toContain(`prefix-42:${venvPrefix}`)
  await orcaPage.screenshot({ path: testInfo.outputPath('python-run-venv.png') })

  // Pinning the system Python sticks for this project and drives both Run and Debug.
  await trigger.click()
  await orcaPage
    .getByRole('menuitem', { name: /\(python3\)/ })
    .first()
    .click()
  await expect(trigger).toContainText('(python3)')
  await orcaPage.getByTestId('python-run-file').click()
  await expect(controls).toHaveAttribute('data-run-status', 'succeeded', { timeout: 30_000 })
  const tabsForFile = await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    const tabs = state?.tabsByWorktree[state.activeWorktreeId ?? ''] ?? []
    return tabs.filter((tab) => tab.quickCommandLabel === 'where.py').length
  })
  expect(tabsForFile).toBe(1)

  await orcaPage.getByTestId('python-debug-file').click()
  const debugConsole = orcaPage.getByTestId('debug-console')
  await expect(debugConsole).toContainText('prefix-42:', { timeout: 120_000 })
  await expect(debugConsole).not.toContainText(venvPrefix)
  await orcaPage.screenshot({ path: testInfo.outputPath('python-debug-system.png') })
})
