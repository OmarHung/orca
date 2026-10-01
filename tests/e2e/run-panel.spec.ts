import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import { getRunPanelTerminalContent, runTerminalsInTabStrip } from './helpers/run-panel'

const SERVER_LABEL = 'E2E panel server'
// Why arithmetic: the output must not match the echoed command line itself.
const SERVER_COMMAND = 'echo panel-up-$((40+2)); sleep 300'
const SERVER_MARKER = 'panel-up-42'
const PROMPT_LABEL = 'E2E panel prompt'
const PROMPT_COMMAND = 'read -r answer; echo "got-$answer"'

type RunTab = { tabId: string; unifiedTabId: string; groupId: string }

async function runFromMenu(page: Page, label: string): Promise<void> {
  await page.getByTestId('run-configurations-trigger').click()
  await page.getByRole('menuitem', { name: label }).click()
  await page.getByRole('button', { name: `Run quick command: ${label}` }).click()
}

/** The run's terminal and the tab-group entry that holds it. */
async function findRunTab(page: Page, label: string): Promise<RunTab | null> {
  return page.evaluate((expected) => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId ?? ''
    const terminal = (state?.tabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.quickCommandLabel === expected
    )
    const unified = (state?.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.contentType === 'terminal' && tab.entityId === terminal?.id
    )
    return terminal && unified
      ? { tabId: terminal.id, unifiedTabId: unified.id, groupId: unified.groupId }
      : null
  }, label)
}

async function groupCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    return (state?.groupsByWorktree[state.activeWorktreeId ?? ''] ?? []).length
  })
}

async function activeGroupTabId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId ?? ''
    const groupId = state?.activeGroupIdByWorktree[worktreeId]
    return (
      (state?.groupsByWorktree[worktreeId] ?? []).find((group) => group.id === groupId)
        ?.activeTabId ?? null
    )
  })
}

test('run terminals stay in the Run panel when splits close, tabs are focused, or runs close', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'run-panel')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(
    async ({ server, prompt }) => {
      await window.__store?.getState().updateSettings({
        terminalQuickCommands: [server, prompt].map(({ label, command }, index) => ({
          id: `e2e-run-panel-${index}`,
          label,
          scope: { type: 'global' as const },
          action: 'terminal-command' as const,
          command,
          appendEnter: true
        }))
      })
    },
    {
      server: { label: SERVER_LABEL, command: SERVER_COMMAND },
      prompt: { label: PROMPT_LABEL, command: PROMPT_COMMAND }
    }
  )

  // Run from a split: the run's terminal joins that split's group but never its tab strip.
  const split = await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const sourceGroupId = worktreeId ? state?.activeGroupIdByWorktree[worktreeId] : undefined
    if (!state || !worktreeId || !sourceGroupId) {
      throw new Error('No group to split')
    }
    const groupId = state.createEmptySplitGroup(worktreeId, sourceGroupId, 'right')
    if (!groupId) {
      throw new Error('Failed to create split group')
    }
    const tab = state.createTab(worktreeId, groupId, undefined, { activate: true })
    state.focusGroup(worktreeId, groupId)
    state.setActiveTab(tab.id)
    return { groupId, tabId: tab.id }
  })
  await expect.poll(() => groupCount(orcaPage)).toBe(2)
  await runFromMenu(orcaPage, SERVER_LABEL)
  await expect
    .poll(() => getRunPanelTerminalContent(orcaPage), { timeout: 30_000 })
    .toContain(SERVER_MARKER)
  const run = await findRunTab(orcaPage, SERVER_LABEL)
  expect(run?.groupId).toBe(split.groupId)
  expect(await runTerminalsInTabStrip(orcaPage, SERVER_LABEL)).toBe(0)
  const panelTab = orcaPage.getByTestId('run-panel-tab')
  await expect(panelTab).toHaveAttribute('data-run-status', 'running')

  // Closing the split's last visible tab still closes the split; the run keeps going.
  await orcaPage.evaluate((tabId) => window.__store?.getState().closeTab(tabId), split.tabId)
  await expect.poll(() => groupCount(orcaPage)).toBe(1)
  await expect.poll(async () => (await findRunTab(orcaPage, SERVER_LABEL))?.tabId).toBe(run?.tabId)
  await expect(panelTab).toHaveAttribute('data-run-status', 'running')
  await orcaPage.screenshot({ path: testInfo.outputPath('run-panel-after-split-closed.png') })

  // Focusing the run's terminal (as the tab palette or CLI focus do) shows it in the Run panel
  // and leaves the tab group on a tab it can show.
  await orcaPage.getByTestId('run-status-toggle').click()
  await expect(orcaPage.getByTestId('run-panel')).toHaveCount(0)
  await orcaPage.evaluate((target) => {
    const state = window.__store?.getState()
    state?.setActiveTab(target.tabId)
    state?.activateTab(target.unifiedTabId)
  }, run!)
  await expect(orcaPage.getByTestId('run-panel')).toBeVisible()
  await expect.poll(() => activeGroupTabId(orcaPage)).not.toBe(run?.unifiedTabId)
  expect(await runTerminalsInTabStrip(orcaPage, SERVER_LABEL)).toBe(0)

  // Closing a run that still runs asks first, like any busy terminal.
  await orcaPage.getByTestId('run-panel-tab-close').click()
  await orcaPage.getByRole('button', { name: /^Cancel$/ }).click()
  await expect(panelTab).toHaveCount(1)

  // Once stopped, it closes at once and the panel is empty again.
  await orcaPage.getByTestId('run-panel-stop').click()
  await expect(panelTab).toHaveAttribute('data-run-status', 'stopped', { timeout: 30_000 })
  await orcaPage.getByTestId('run-panel-tab-close').click()
  await expect(panelTab).toHaveCount(0)
  await expect.poll(() => findRunTab(orcaPage, SERVER_LABEL)).toBeNull()
  await expect(orcaPage.getByTestId('run-panel')).toContainText('Nothing has run here yet')

  // Like a JetBrains Run console, the run reads what is typed into the panel.
  await runFromMenu(orcaPage, PROMPT_LABEL)
  await expect(panelTab).toHaveAttribute('data-run-status', 'running', { timeout: 30_000 })
  await orcaPage.getByTestId('run-panel-terminal').click()
  await orcaPage.keyboard.type('orca')
  await orcaPage.keyboard.press('Enter')
  await expect
    .poll(() => getRunPanelTerminalContent(orcaPage), { timeout: 30_000 })
    .toContain('got-orca')
  await expect(panelTab).toHaveAttribute('data-run-status', 'succeeded', { timeout: 30_000 })
})
