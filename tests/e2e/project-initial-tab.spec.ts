import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal-pane-identity'

// Why: an echo override proves the agent launch without running the real Claude CLI.
const PROBE = 'orca-initial-tab-probe'

async function activeTabAgents(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() => {
    const state = window.__store!.getState()
    return (state.tabsByWorktree[state.activeWorktreeId ?? ''] ?? []).map(
      (tab) => tab.launchAgent ?? null
    )
  })
}

async function openRepoSettings(page: Page, repoId: string): Promise<void> {
  await page.evaluate((nextRepoId) => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'repo', repoId: nextRepoId })
    state.openSettingsPage()
  }, repoId)
  await expect(page.getByPlaceholder('Search settings')).toBeVisible({ timeout: 10_000 })
}

test('an empty workspace opens the project initial tab chosen in settings', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  const repoId = await orcaPage.evaluate(async (probe) => {
    const state = window.__store!.getState()
    await state.updateSettings({
      agentCmdOverrides: { ...state.settings?.agentCmdOverrides, claude: `echo ${probe}` }
    })
    const seededRepoId = state.getKnownWorktreeById(state.activeWorktreeId!)!.repoId
    // The shared fixture pins a plain shell; switch it back to the Claude default.
    await state.updateRepo(seededRepoId, { initialTab: 'claude' })
    return seededRepoId
  }, PROBE)
  expect(
    await orcaPage.evaluate(
      (id) => window.__store!.getState().repos.find((repo) => repo.id === id)?.initialTab,
      repoId
    )
  ).toBe('claude')

  const agentWorktree = createGoldenWorktree(testRepoPath, 'initial-agent')
  registerPostElectronShutdownCleanup(async () =>
    cleanupGoldenWorktree(testRepoPath, agentWorktree)
  )
  await activateGoldenWorktree(orcaPage, testRepoPath, agentWorktree.worktreePath)
  await expect.poll(() => activeTabAgents(orcaPage), { timeout: 20_000 }).toEqual(['claude'])
  await expect
    .poll(() => getTerminalContent(orcaPage, 20_000), { timeout: 20_000 })
    .toContain(PROBE)

  await openRepoSettings(orcaPage, repoId)
  const initialTab = orcaPage.getByRole('combobox', { name: 'Initial Tab' })
  await expect(initialTab).toContainText('Claude')
  await initialTab.scrollIntoViewIfNeeded()
  await orcaPage.screenshot({ path: testInfo.outputPath('initial-tab-setting.png') })
  await initialTab.click()
  await orcaPage.getByRole('option', { name: 'Terminal' }).click()
  await expect(initialTab).toContainText('Terminal')
  await expect
    .poll(() =>
      orcaPage.evaluate(
        (id) => window.__store!.getState().repos.find((repo) => repo.id === id)?.initialTab,
        repoId
      )
    )
    .toBe('terminal')

  const shellWorktree = createGoldenWorktree(testRepoPath, 'initial-shell')
  registerPostElectronShutdownCleanup(async () =>
    cleanupGoldenWorktree(testRepoPath, shellWorktree)
  )
  await orcaPage.evaluate(() => window.__store!.getState().setActiveView('terminal'))
  await activateGoldenWorktree(orcaPage, testRepoPath, shellWorktree.worktreePath)
  await expect.poll(() => activeTabAgents(orcaPage), { timeout: 20_000 }).toEqual([null])
  await orcaPage.screenshot({ path: testInfo.outputPath('initial-tab-shell.png') })
  expect(await getTerminalContent(orcaPage, 20_000)).not.toContain(PROBE)
})
