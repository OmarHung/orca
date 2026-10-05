import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import { getRunPanelTerminalContent, runTerminalsInTabStrip } from './helpers/run-panel'

const QUICK_LABEL = 'E2E quick run'
const LONG_LABEL = 'E2E long run'
// Why arithmetic: the output must not match the echoed command line itself.
const LONG_COMMAND = 'echo long-run-$((40+2)); sleep 300'
const LONG_STARTED_MARKER = 'long-run-42'

/** Waits until the long command has printed its start marker `count` times in the Run panel. */
async function waitForLongRunStarts(page: Page, count: number): Promise<void> {
  await expect
    .poll(
      async () =>
        (await getRunPanelTerminalContent(page, 20_000)).split(LONG_STARTED_MARKER).length - 1,
      { timeout: 30_000 }
    )
    .toBeGreaterThanOrEqual(count)
}

async function tabCountWithLabel(page: Page, label: string): Promise<number> {
  return page.evaluate((expected) => {
    const state = window.__store?.getState()
    const tabs = state?.tabsByWorktree[state.activeWorktreeId ?? ''] ?? []
    return tabs.filter((tab) => tab.quickCommandLabel === expected).length
  }, label)
}

/** Shows the run's output in the Run panel, as clicking its tab in JetBrains' Run tool window. */
async function showRunInPanel(page: Page, label: string): Promise<void> {
  await page.getByTestId('run-panel-tab').filter({ hasText: label }).click()
}

async function runFromMenu(page: Page, label: string): Promise<void> {
  await page.getByTestId('run-configurations-trigger').click()
  await page.getByRole('menuitem', { name: label }).click()
  await page.getByRole('button', { name: `Run quick command: ${label}` }).click()
}

test('runs, reruns and stops a quick command as a single-instance run configuration', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'run-configurations')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(
    async ({ quickLabel, longLabel, longCommand }) => {
      await window.__store?.getState().updateSettings({
        terminalQuickCommands: [
          {
            id: 'e2e-run-quick',
            label: quickLabel,
            scope: { type: 'global' },
            action: 'terminal-command',
            command: 'echo run-configuration-ok',
            appendEnter: true
          },
          {
            id: 'e2e-run-long',
            label: longLabel,
            scope: { type: 'global' },
            action: 'terminal-command',
            command: longCommand,
            appendEnter: true
          }
        ]
      })
    },
    { quickLabel: QUICK_LABEL, longLabel: LONG_LABEL, longCommand: LONG_COMMAND }
  )
  const controls = orcaPage.getByTestId('run-configurations-session')
  const triggerStatus = orcaPage
    .getByTestId('run-configurations-trigger')
    .getByTestId('run-configurations-trigger-status')

  // No .vscode/launch.json in this workspace, so the menu offers no import.
  await orcaPage.getByTestId('run-configurations-trigger').click()
  await expect(orcaPage.getByTestId('run-configurations-edit')).toBeVisible()
  await expect(orcaPage.getByTestId('run-configurations-import')).toHaveCount(0)
  await orcaPage.keyboard.press('Escape')
  await expect(orcaPage.getByRole('menu')).toHaveCount(0)

  // A command that exits on its own finishes, and running it again reuses its terminal.
  await runFromMenu(orcaPage, QUICK_LABEL)
  await expect(controls).toHaveAttribute('data-run-status', 'succeeded', { timeout: 30_000 })
  // Like JetBrains, the run opens the Run tool window instead of a terminal tab.
  await expect(orcaPage.getByTestId('run-panel')).toBeVisible()
  await expect(orcaPage.getByTestId('run-status-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => getRunPanelTerminalContent(orcaPage), { timeout: 30_000 })
    .toContain('run-configuration-ok')
  expect(await runTerminalsInTabStrip(orcaPage, QUICK_LABEL)).toBe(0)
  await orcaPage.getByRole('button', { name: `Run quick command: ${QUICK_LABEL}` }).click()
  await expect(controls).toHaveAttribute('data-run-status', 'succeeded', { timeout: 30_000 })
  expect(await tabCountWithLabel(orcaPage, QUICK_LABEL)).toBe(1)

  // A long-running command can be rerun in place and then stopped with Ctrl-C.
  await runFromMenu(orcaPage, LONG_LABEL)
  await expect(controls).toHaveAttribute('data-run-status', 'running')
  // While it runs, Rerun and Stop replace Run, as in JetBrains.
  await expect(orcaPage.getByTestId('run-configurations-launch')).toHaveCount(0)
  // The live status sits beside the name; among the buttons it read as another Run button.
  await expect(triggerStatus).toBeVisible()
  await waitForLongRunStarts(orcaPage, 1)
  await orcaPage.screenshot({ path: testInfo.outputPath('run-configuration-running.png') })

  await controls.getByTestId('run-rerun').click()
  // Two start markers in the same pane: Ctrl-C ended the first run and it restarted in place.
  await waitForLongRunStarts(orcaPage, 2)
  await expect(controls).toHaveAttribute('data-run-status', 'running')
  expect(await tabCountWithLabel(orcaPage, LONG_LABEL)).toBe(1)

  // With both runs open, the Run widget follows whichever run the Run panel shows.
  const trigger = orcaPage.getByTestId('run-configurations-trigger')
  await expect(orcaPage.getByTestId('run-panel-tab')).toHaveCount(2)
  await showRunInPanel(orcaPage, QUICK_LABEL)
  await expect(trigger).toContainText(QUICK_LABEL)
  await expect(controls).toHaveAttribute('data-run-status', 'succeeded')
  await expect(triggerStatus).toHaveCount(0)
  await showRunInPanel(orcaPage, LONG_LABEL)
  await expect(trigger).toContainText(LONG_LABEL)
  await expect(controls).toHaveAttribute('data-run-status', 'running')

  // The status-bar button hides and shows the Run tool window; the run keeps its output.
  await orcaPage.getByTestId('run-status-toggle').click()
  await expect(orcaPage.getByTestId('run-panel')).toHaveCount(0)
  await orcaPage.getByTestId('run-status-toggle').click()
  await expect(orcaPage.getByTestId('run-panel')).toBeVisible()
  await waitForLongRunStarts(orcaPage, 2)
  expect(await runTerminalsInTabStrip(orcaPage, LONG_LABEL)).toBe(0)

  // The only live run, so the shared Stop control stops it directly.
  const stopControl = orcaPage.getByTestId('run-stop-control')
  await expect(stopControl).toHaveAttribute('data-count', '1')
  await stopControl.getByTestId('run-stop').click()
  await expect(controls).toHaveAttribute('data-run-status', 'stopped', { timeout: 30_000 })
  await expect(stopControl).toHaveCount(0)
  await expect(orcaPage.getByTestId('run-configurations-launch')).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('run-configuration-stopped.png') })
})
