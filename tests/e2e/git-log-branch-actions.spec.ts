import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

test('runs JetBrains-style branch and commit actions from the Git Log', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.setTimeout(180_000)
  const fixture = createGoldenWorktree(testRepoPath, 'git-log-actions')
  const cwd = fixture.worktreePath
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
  registerPostElectronShutdownCleanup(async () => {
    // Why: cleanup deletes the fixture branch, which git refuses while it is checked out elsewhere.
    git('checkout', '-q', '--force', fixture.branchName)
    cleanupGoldenWorktree(testRepoPath, fixture)
  })
  const sharedPath = path.join(cwd, 'shared.txt')
  const commitShared = (content: string, subject: string): void => {
    writeFileSync(sharedPath, content)
    git('add', 'shared.txt')
    git('commit', '--no-verify', '-q', '-m', subject)
  }
  const current = (): string => git('branch', '--show-current')
  const sideBranch = `${fixture.branchName}-side`
  commitShared('one\ntwo\nthree\n', 'feat: add shared')
  git('checkout', '-q', '-b', sideBranch)
  commitShared('ONE\ntwo\nthree\n', 'feat: side edits line one')
  git('checkout', '-q', fixture.branchName)
  commitShared('uno\ntwo\nthree\n', 'feat: main edits line one')

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, cwd)
  await orcaPage.getByTestId('git-log-status-toggle').click()
  const panel = orcaPage.getByTestId('bottom-panel')
  const tree = panel.getByTestId('git-log-branch-tree')
  const branchRow = (name: string) => tree.getByRole('button', { name: new RegExp(`${name}$`) })
  const pick = async (name: string): Promise<void> => {
    await orcaPage.getByRole('menuitem', { name, exact: true }).click()
    await expect(orcaPage.getByRole('menu')).toHaveCount(0)
  }
  const toast = (text: string) => orcaPage.getByText(text, { exact: true })
  await expect(branchRow(sideBranch)).toBeVisible({ timeout: 20_000 })

  // A local change git refuses to carry over opens the dialog; Smart Checkout keeps it.
  writeFileSync(sharedPath, 'uno\ntwo\nTHREE\n')
  await branchRow(sideBranch).click({ button: 'right' })
  await pick('Checkout')
  const dialog = orcaPage.getByRole('dialog')
  await expect(dialog).toContainText('Local changes would be overwritten')
  await expect(dialog).toContainText('shared.txt')
  await dialog.getByRole('button', { name: 'Smart Checkout' }).click()
  await expect.poll(current).toBe(sideBranch)
  expect(readFileSync(sharedPath, 'utf8')).toBe('ONE\ntwo\nTHREE\n')
  await expect(toast(`Checked out ${sideBranch}`)).toBeVisible()

  // Force Checkout drops the local change instead.
  await branchRow(fixture.branchName).click({ button: 'right' })
  await pick('Checkout')
  await dialog.getByRole('button', { name: 'Force Checkout' }).click()
  await expect.poll(current).toBe(fixture.branchName)
  expect(readFileSync(sharedPath, 'utf8')).toBe('uno\ntwo\nthree\n')

  // A conflicting merge stops; the toast's Abort puts the tree back.
  await branchRow(sideBranch).click({ button: 'right' })
  await pick(`Merge “${sideBranch}” into “${fixture.branchName}”`)
  await expect(toast('Merge stopped on conflicts')).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Abort' }).click()
  await expect.poll(() => git('status', '--porcelain')).toBe('')
  expect(() => git('rev-parse', '--quiet', '--verify', 'MERGE_HEAD')).toThrow()

  // New Branch from a commit, checked out, then renamed from the branch tree.
  const fromBase = `${fixture.branchName}-base`
  await panel.getByTestId('git-log-row').filter({ hasText: 'feat: add shared' }).click({
    button: 'right'
  })
  await pick('New Branch…')
  await dialog.getByRole('textbox', { name: 'Name' }).fill(fromBase)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect.poll(current).toBe(fromBase)
  expect(git('log', '-1', '--format=%s')).toBe('feat: add shared')

  const renamed = `${fromBase}-renamed`
  await expect(branchRow(fromBase)).toBeVisible()
  await branchRow(fromBase).click({ button: 'right' })
  await pick('Rename…')
  await dialog.getByRole('textbox', { name: 'Name' }).fill(renamed)
  await dialog.getByRole('button', { name: 'Rename' }).click()
  await expect.poll(current).toBe(renamed)
  await expect(branchRow(renamed)).toBeVisible()

  // Push publishes the branch; a later local commit then shows ↑1 on its row.
  const remotePath = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-push-remote-'))
  execFileSync('git', ['init', '--bare', '-q', remotePath])
  git('remote', 'add', 'origin', remotePath)
  registerPostElectronShutdownCleanup(async () => {
    execFileSync('git', ['remote', 'remove', 'origin'], { cwd: testRepoPath, stdio: 'pipe' })
    rmSync(remotePath, { recursive: true, force: true })
  })
  await branchRow(renamed).click({ button: 'right' })
  await pick('Push')
  await expect(toast(`Pushed ${renamed}`)).toBeVisible()
  expect(git('rev-parse', '--abbrev-ref', '@{u}')).toBe(`origin/${renamed}`)
  const logRow = (subject: string) => panel.getByTestId('git-log-row').filter({ hasText: subject })
  // The branch badge shows its remote branch is on the same commit.
  await expect(logRow('feat: add shared').getByTestId('git-log-remote-also-here')).toBeVisible()
  commitShared('ahead\n', 'feat: unpushed work')
  await panel.getByRole('button', { name: 'Refresh log' }).click()
  await expect(branchRow(renamed).getByTestId('git-log-branch-sync')).toHaveText('1')
  await expect(logRow('feat: unpushed work')).toHaveAttribute('data-unpushed', 'true')
  await expect(logRow('feat: add shared')).not.toHaveAttribute('data-unpushed', 'true')

  // Fetch from the toolbar.
  await panel.getByTestId('git-log-fetch').click()
  await expect(toast('Fetched all remotes')).toBeVisible()
})
