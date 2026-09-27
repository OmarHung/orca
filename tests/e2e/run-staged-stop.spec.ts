import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const TRAPS_INT = 'E2E traps SIGINT'
const TRAPS_BOTH = 'E2E traps both'
// Unique to each program's command line, so pgrep finds exactly that program.
const TRAPS_INT_PATTERN = "trap-int-' "
const TRAPS_BOTH_PATTERN = "trap-both-' "

function programPids(pattern: string): string[] {
  try {
    return execFileSync('pgrep', ['-f', pattern]).toString().trim().split('\n').filter(Boolean)
  } catch {
    // pgrep exits 1 when nothing matches.
    return []
  }
}

async function runFromMenu(page: Page, label: string): Promise<void> {
  await page.getByTestId('run-configurations-trigger').click()
  await page.getByRole('menuitem', { name: label }).click()
  await page.getByRole('button', { name: `Run quick command: ${label}` }).click()
}

async function tabCountWithLabel(page: Page, label: string): Promise<number> {
  return page.evaluate((expected) => {
    const state = window.__store?.getState()
    const tabs = state?.tabsByWorktree[state.activeWorktreeId ?? ''] ?? []
    return tabs.filter((tab) => tab.quickCommandLabel === expected).length
  }, label)
}

test('Stop goes one step further per press and keeps the terminal until the last step', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.skip(process.platform === 'win32', 'Relies on SIGQUIT and pgrep')
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'run-staged-stop')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(
    async ({ trapsInt, trapsBoth }) => {
      const keepAlive = 'setInterval(() => {}, 1000)'
      await window.__store?.getState().updateSettings({
        terminalQuickCommands: [
          {
            id: 'e2e-traps-int',
            label: trapsInt,
            scope: { type: 'global' },
            action: 'terminal-command',
            command: `node -e "process.on('SIGINT', () => {}); console.log('trap-int-' + 1); ${keepAlive}"`,
            appendEnter: true
          },
          {
            id: 'e2e-traps-both',
            label: trapsBoth,
            scope: { type: 'global' },
            action: 'terminal-command',
            command: `node -e "process.on('SIGINT', () => {}); process.on('SIGQUIT', () => {}); console.log('trap-both-' + 2); ${keepAlive}"`,
            appendEnter: true
          }
        ]
      })
    },
    { trapsInt: TRAPS_INT, trapsBoth: TRAPS_BOTH }
  )
  const stop = orcaPage.getByTestId('run-stop-control').getByTestId('run-stop')
  const session = orcaPage.getByTestId('run-configurations-session')

  // A program that traps Ctrl-C: the first press only asks, the second forces it, and the
  // terminal stays open.
  await runFromMenu(orcaPage, TRAPS_INT)
  await expect
    .poll(() => programPids(TRAPS_INT_PATTERN).length, { timeout: 30_000 })
    .toBeGreaterThan(0)
  await expect(stop).toHaveAccessibleName(`Stop '${TRAPS_INT}'`)
  await stop.click()
  await expect(session).toHaveAttribute('data-run-status', 'stopping')
  await expect(stop).toHaveAccessibleName(`Force stop '${TRAPS_INT}'`)
  expect(programPids(TRAPS_INT_PATTERN)).not.toHaveLength(0)
  await orcaPage.screenshot({ path: testInfo.outputPath('force-stop-offered.png') })
  await stop.click()
  await expect.poll(() => programPids(TRAPS_INT_PATTERN).length, { timeout: 30_000 }).toBe(0)
  await expect(session).toHaveAttribute('data-run-status', 'stopped', { timeout: 30_000 })
  expect(await tabCountWithLabel(orcaPage, TRAPS_INT)).toBe(1)

  // A program that traps both: only the explicitly labelled third press closes its terminal.
  await runFromMenu(orcaPage, TRAPS_BOTH)
  await expect
    .poll(() => programPids(TRAPS_BOTH_PATTERN).length, { timeout: 30_000 })
    .toBeGreaterThan(0)
  await stop.click()
  await stop.click()
  await expect(stop).toHaveAccessibleName(`Close terminal '${TRAPS_BOTH}'`)
  expect(await tabCountWithLabel(orcaPage, TRAPS_BOTH)).toBe(1)
  await stop.click()
  await expect.poll(() => tabCountWithLabel(orcaPage, TRAPS_BOTH), { timeout: 30_000 }).toBe(0)
  await expect(orcaPage.getByTestId('run-stop-control')).toHaveCount(0)
})
