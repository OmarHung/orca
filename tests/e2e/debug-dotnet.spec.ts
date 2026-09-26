import { execFileSync } from 'node:child_process'
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

const SOURCE = 'var answer = 41;\nanswer += 1;\nConsole.WriteLine("answer=" + answer);\n'

function hasDotnet(): boolean {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// Why skip: needs a .NET SDK, and the first run downloads netcoredbg.
test.skip(!hasDotnet(), 'the dotnet SDK is not installed')

function explorerRow(page: Page, name: string) {
  return page
    .locator('[data-orca-explorer-shell] [data-file-explorer-row]')
    .filter({ has: page.locator('[data-file-explorer-row-name]').getByText(name, { exact: true }) })
}

test('debugs a .NET project from the file tree, stopping at a C# breakpoint', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(300_000)
  const fixture = createGoldenWorktree(testRepoPath, 'debug-dotnet')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const project = path.join(fixture.worktreePath, 'Demo')
  execFileSync('dotnet', ['new', 'console', '-n', 'Demo', '-o', project], {
    stdio: 'pipe',
    timeout: 120_000
  })
  writeFileSync(path.join(project, 'Program.cs'), SOURCE)

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarTab('source-control')
    state?.setRightSidebarOpen(true)
  })
  await orcaPage.getByRole('button', { name: 'Explorer' }).click()
  await explorerRow(orcaPage, 'Demo').click()
  await explorerRow(orcaPage, 'Program.cs').click()
  const editor = orcaPage.locator('.monaco-editor').first()
  await expect(editor).toContainText('answer = 41', { timeout: 25_000 })

  const lineTwo = await editor.locator('.line-numbers').filter({ hasText: /^2$/ }).boundingBox()
  expect(lineTwo).not.toBeNull()
  await orcaPage.mouse.click(lineTwo!.x - 6, lineTwo!.y + lineTwo!.height / 2)
  await expect(editor.locator('.orca-debug-breakpoint')).toHaveCount(1)

  await explorerRow(orcaPage, 'Demo').click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: "Debug 'Demo: Run'" }).click()

  const panel = orcaPage.getByTestId('debug-panel')
  // Why the long timeout: first use downloads netcoredbg, then the project builds.
  await expect(panel.getByTestId('debug-frames')).toContainText('Program.cs:2', {
    timeout: 240_000
  })
  await expect(panel.getByTestId('debug-variables')).toContainText('answer')
  await expect(panel.getByTestId('debug-variables')).toContainText('41')
  await expect(editor.locator('.orca-debug-execution-line')).toHaveCount(1)
  await orcaPage.screenshot({ path: testInfo.outputPath('dotnet-paused.png') })

  await panel.getByRole('button', { name: 'Resume Program' }).click()
  await expect(panel.getByTestId('debug-console')).toContainText('answer=42', { timeout: 60_000 })
  await orcaPage.screenshot({ path: testInfo.outputPath('dotnet-finished.png') })
})
