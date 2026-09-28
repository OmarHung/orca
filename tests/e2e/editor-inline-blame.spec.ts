import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const FILE_NAME = 'notes.ts'
const AUTHOR = 'Blame Author'

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

async function openEditorFile(page: Page, worktreePath: string, relativePath: string) {
  await page.evaluate(
    ({ root, rel }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (!state || !worktreeId) {
        throw new Error('no active worktree')
      }
      const separator = root.includes('\\') ? '\\' : '/'
      state.openFile({
        filePath: `${root}${separator}${rel}`,
        relativePath: rel,
        worktreeId,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { root: worktreePath, rel: relativePath }
  )
}

test('inline blame names the author of the caret line and opens its commit', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'inline-blame')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const worktree = fixture.worktreePath
  writeFileSync(join(worktree, FILE_NAME), 'export const a = 1\nexport const b = 2\n')
  git(['add', FILE_NAME], worktree)
  git(
    [
      '-c',
      `user.name=${AUTHOR}`,
      '-c',
      'user.email=blame@example.invalid',
      'commit',
      '--no-verify',
      '-m',
      'Seed the notes module'
    ],
    worktree
  )
  // An uncommitted edit on line 2.
  writeFileSync(join(worktree, FILE_NAME), 'export const a = 1\nexport const b = 3\n')

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, worktree)
  await openEditorFile(orcaPage, worktree, FILE_NAME)

  const lines = orcaPage.locator('.monaco-editor .view-line')
  const annotation = orcaPage.locator('.monaco-editor .orca-inline-blame')
  await lines.nth(0).click()
  // Why \s: Monaco renders spaces in injected text as non-breaking spaces.
  await expect(annotation).toHaveText(/^Blame\sAuthor,\s.+\s•\sSeed\sthe\snotes\smodule$/, {
    timeout: 30_000
  })
  await orcaPage.screenshot({ path: testInfo.outputPath('inline-blame.png') })

  await lines.nth(1).click()
  await expect(annotation).toHaveText(/^Uncommitted\schanges$/)

  await lines.nth(0).click()
  await expect(annotation).toHaveText(/Seed\sthe\snotes\smodule$/)
  await annotation.hover()
  const hover = orcaPage.locator('.monaco-hover').filter({ hasText: 'Open Changes' })
  await expect(hover).toBeVisible()
  await expect(hover).toContainText('blame@example.invalid')
  await orcaPage.screenshot({ path: testInfo.outputPath('inline-blame-hover.png') })

  await hover.getByText('Open Changes').click()
  await expect
    .poll(() =>
      orcaPage.evaluate(
        () =>
          window.__store
            ?.getState()
            .openFiles.some(
              (file) => file.mode === 'diff' && file.diffSource === 'combined-commit'
            ) ?? false
      )
    )
    .toBe(true)
})
