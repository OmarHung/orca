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

const FILE_NAME = 'notes.ts'

async function pickEditorMenuItem(page: Page, name: string): Promise<void> {
  const item = page.getByRole('menuitem', { name })
  await item.hover()
  // Why: Monaco's context menu ignores a click that lands right after it opened.
  await page.waitForTimeout(300)
  await item.click()
}

async function openEditorFile(page: Page, worktreePath: string) {
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
    { root: worktreePath, rel: FILE_NAME }
  )
}

test('compares an editor file with another branch and an older revision', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'revision-compare')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const cwd = fixture.worktreePath
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
  const commitNotes = (content: string, subject: string): string => {
    writeFileSync(path.join(cwd, FILE_NAME), content)
    git('add', FILE_NAME)
    git('commit', '--no-verify', '-m', subject)
    return git('rev-parse', 'HEAD')
  }
  const sideBranch = `${fixture.branchName}-side`
  const first = commitNotes('export const version = "first"\n', 'feat: first notes')
  git('checkout', '-q', '-b', sideBranch)
  commitNotes('export const version = "side"\n', 'feat: side notes')
  git('checkout', '-q', fixture.branchName)
  writeFileSync(path.join(cwd, 'other.txt'), 'unrelated\n')
  git('add', 'other.txt')
  git('commit', '--no-verify', '-m', 'chore: unrelated change')
  commitNotes('export const version = "second"\n', 'feat: second notes')
  writeFileSync(path.join(cwd, FILE_NAME), 'export const version = "working"\n')

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, cwd)
  await openEditorFile(orcaPage, cwd)

  const lines = orcaPage.locator('.monaco-editor .view-lines').first()
  await expect(lines).toContainText('working', { timeout: 30_000 })
  const compareView = orcaPage.getByTestId('revision-compare-view')

  // Compare with Branch…
  await lines.click({ button: 'right' })
  await pickEditorMenuItem(orcaPage, 'Git: Compare with Branch…')
  const dialog = orcaPage.getByRole('dialog', { name: 'Compare with Branch' })
  await dialog.getByPlaceholder('Search branches…').fill('-side')
  await dialog.getByRole('option', { name: new RegExp(`${sideBranch}$`) }).click()
  await expect(compareView).toContainText(`Comparing with ${sideBranch}`)
  await expect(compareView.locator('.monaco-diff-editor')).toContainText('side', {
    timeout: 20_000
  })
  await expect(compareView.locator('.monaco-diff-editor')).toContainText('working')
  await compareView.getByRole('button', { name: 'Close Comparison' }).click()
  await expect(compareView).toBeHidden()

  // Compare with Revision… lists only commits that touched the file.
  await lines.click({ button: 'right' })
  await pickEditorMenuItem(orcaPage, 'Git: Compare with Revision…')
  const revisions = orcaPage.getByRole('dialog', { name: 'Compare with Revision' })
  await expect(revisions.getByText('Commits that changed this file')).toBeVisible()
  await expect(revisions.getByRole('option')).toHaveCount(2)
  await expect(revisions.getByRole('option', { name: /unrelated change/ })).toHaveCount(0)
  await revisions.getByRole('option', { name: /first notes/ }).click()
  await expect(compareView).toContainText(`Comparing with ${first.slice(0, 7)}`)
  await expect(compareView.locator('.monaco-diff-editor')).toContainText('first', {
    timeout: 20_000
  })
})
