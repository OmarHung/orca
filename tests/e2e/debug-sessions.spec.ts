import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import { launchCurrentFile } from './helpers/run-panel'

const FILES: Record<string, string[]> = {
  'first.py': ['a = 1', 'print("first", a)', ''],
  'second.py': ['b = 2', 'print("second", b)', ''],
  'web.js': ['const c = 3', 'console.log(c)', '']
}

function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

async function openFile(page: Page, name: string): Promise<Locator> {
  await page
    .locator('[data-orca-explorer-shell] [data-file-explorer-row]')
    .filter({
      has: page.locator('[data-file-explorer-row-name]').getByText(name, { exact: true })
    })
    .click()
  const editor = page.locator('.monaco-editor:visible').first()
  await expect(editor).toContainText(FILES[name][0], { timeout: 25_000 })
  return editor
}

/** Opens a file from the Explorer and puts a breakpoint on line 2 (its print). */
async function openWithBreakpoint(page: Page, name: string): Promise<void> {
  const editor = await openFile(page, name)
  const lineTwo = await editor.locator('.line-numbers').filter({ hasText: /^2$/ }).boundingBox()
  expect(lineTwo).not.toBeNull()
  await page.mouse.click(lineTwo!.x - 6, lineTwo!.y + lineTwo!.height / 2)
  await expect(editor.locator('.orca-debug-breakpoint')).toHaveCount(1)
}

test.skip(!hasPython(), 'python3 is not installed')

test('debugs several programs at once, one tab each, with their own breakpoints', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(240_000)
  const fixture = createGoldenWorktree(testRepoPath, 'debug-sessions')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  for (const [name, lines] of Object.entries(FILES)) {
    writeFileSync(path.join(fixture.worktreePath, name), lines.join('\n'))
  }

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarTab('source-control')
    state?.setRightSidebarOpen(true)
  })
  await orcaPage.getByRole('button', { name: 'Explorer' }).click()
  await openWithBreakpoint(orcaPage, 'web.js')
  await openWithBreakpoint(orcaPage, 'second.py')
  await openWithBreakpoint(orcaPage, 'first.py')

  const panel = orcaPage.getByTestId('debug-panel')
  const frames = panel.getByTestId('debug-frames')
  const tabs = orcaPage.getByTestId('debug-session-tab')
  await launchCurrentFile(orcaPage, 'debug')
  await expect(frames).toContainText('first.py:2', { timeout: 120_000 })

  // Debugging a second file opens a second session; the first stays paused.
  await openFile(orcaPage, 'second.py')
  await launchCurrentFile(orcaPage, 'debug')
  await expect(frames).toContainText('second.py:2', { timeout: 120_000 })
  await expect(tabs).toHaveCount(2)
  await expect(tabs.filter({ hasText: 'first.py' })).toHaveAttribute('data-debug-paused', 'true')
  await expect(tabs.filter({ hasText: 'second.py' })).toHaveAttribute('aria-selected', 'true')
  await orcaPage.screenshot({ path: testInfo.outputPath('two-sessions.png') })

  // Each tab shows its own frames and variables.
  await tabs.filter({ hasText: 'first.py' }).click()
  await expect(frames).toContainText('first.py:2')
  await expect(panel.getByTestId('debug-variables')).toContainText('a')

  // Breakpoints lists only this workspace's Python files for a Python session.
  await panel.getByRole('tab', { name: 'Breakpoints' }).click()
  const breakpoints = panel.getByTestId('debug-breakpoints')
  await expect(breakpoints).toContainText('first.py:2')
  await expect(breakpoints).toContainText('second.py:2')
  await expect(breakpoints).not.toContainText('web.js')

  // Resuming one program ends only its session.
  await panel.getByRole('button', { name: 'Resume Program' }).click()
  await expect(tabs.filter({ hasText: 'first.py' })).toHaveAttribute('data-debug-phase', 'ended', {
    timeout: 30_000
  })
  await expect(tabs.filter({ hasText: 'second.py' })).toHaveAttribute('data-debug-paused', 'true')

  // Closing a finished tab removes it; the other session keeps running.
  await orcaPage.getByRole('button', { name: /^Close '.*first\.py'$/ }).click()
  await expect(tabs).toHaveCount(1)
  await expect(frames).toContainText('second.py:2')
  await panel.getByRole('button', { name: 'Stop' }).click()
  await expect(tabs.first()).toHaveAttribute('data-debug-phase', 'ended', { timeout: 30_000 })
})
