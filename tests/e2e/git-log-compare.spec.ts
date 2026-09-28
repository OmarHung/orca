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

type CompareTab = { label: string; parentOid: string | null; commitOid: string; paths: string[] }

async function readCompareTabs(page: Page): Promise<CompareTab[]> {
  return page.evaluate(() =>
    (window.__store?.getState().openFiles ?? [])
      .filter((file) => file.id.includes('::all-diffs::compare::'))
      .map((file) => ({
        label: file.relativePath,
        parentOid: file.commitCompare?.parentOid ?? null,
        commitOid: file.commitCompare?.commitOid ?? '',
        paths: (file.commitEntriesSnapshot ?? []).map((entry) => entry.path).sort()
      }))
  )
}

test('compares two commits and two branches from the Git Log context menus', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'git-log-compare')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const cwd = fixture.worktreePath
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
  const commitFile = (file: string, content: string, subject: string): string => {
    writeFileSync(path.join(cwd, file), content)
    git('add', file)
    git('commit', '--no-verify', '-m', subject)
    return git('rev-parse', 'HEAD')
  }
  const sideBranch = `${fixture.branchName}-side`
  const alpha = commitFile('alpha.txt', 'one\n', 'feat: add alpha')
  git('checkout', '-q', '-b', sideBranch)
  const side = commitFile('gamma.txt', 'side\n', 'feat: add gamma on the side')
  git('checkout', '-q', fixture.branchName)
  const beta = commitFile('beta.txt', 'b\n', 'feat: add beta')
  const tweak = commitFile('alpha.txt', 'two\n', 'fix: tweak alpha')

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, cwd)
  await orcaPage.getByTestId('git-log-status-toggle').click()
  const panel = orcaPage.getByTestId('bottom-panel')
  const rows = panel.getByTestId('git-log-row')
  const row = (subject: string) => rows.filter({ hasText: subject })
  // Why: a closing menu still animates out; wait so the next right-click finds one menu.
  const pick = async (name: string): Promise<void> => {
    await orcaPage.getByRole('menuitem', { name }).click()
    await expect(orcaPage.getByRole('menu')).toHaveCount(0)
  }
  await expect(row('fix: tweak alpha')).toBeVisible({ timeout: 20_000 })

  // ⌘/Ctrl+click picks a second commit; the older one becomes the base.
  await row('fix: tweak alpha').click()
  await row('feat: add alpha').click({ modifiers: ['ControlOrMeta'] })
  await row('feat: add alpha').click({ button: 'right' })
  await pick('Compare Versions')
  await expect
    .poll(() => readCompareTabs(orcaPage))
    .toContainEqual({
      label: `Compare ${alpha.slice(0, 7)} → ${tweak.slice(0, 7)}`,
      parentOid: alpha,
      commitOid: tweak,
      paths: ['alpha.txt', 'beta.txt']
    })

  // Select for Compare, then Compare with the selection.
  await row('feat: add beta').click({ button: 'right' })
  await pick('Select for Compare')
  await row('fix: tweak alpha').click({ button: 'right' })
  await pick(`Compare with “${beta.slice(0, 7)}”`)
  await expect
    .poll(() => readCompareTabs(orcaPage))
    .toContainEqual({
      label: `Compare ${beta.slice(0, 7)} → ${tweak.slice(0, 7)}`,
      parentOid: beta,
      commitOid: tweak,
      paths: ['alpha.txt']
    })

  // A branch compares against the current branch from the branch tree.
  const tree = panel.getByTestId('git-log-branch-tree')
  await tree.getByRole('button', { name: new RegExp(`${sideBranch}$`) }).click({ button: 'right' })
  await pick('Compare with Current Branch')
  await expect
    .poll(() => readCompareTabs(orcaPage))
    .toContainEqual({
      label: `Compare ${fixture.branchName} → ${sideBranch}`,
      parentOid: tweak,
      commitOid: side,
      paths: ['alpha.txt', 'beta.txt', 'gamma.txt']
    })

  // Several selected commits show the files changed across the span they cover.
  const initial = git('rev-parse', `${alpha}^`)
  await row('fix: tweak alpha').click()
  await row('feat: add alpha').click({ modifiers: ['Shift'] })
  const range = panel.getByTestId('git-log-range-details')
  await expect(range).toContainText('3 commits · 2 changed files')
  await expect(range).toContainText(`Changes from ${initial.slice(0, 7)} to ${tweak.slice(0, 7)}`)
  await row('feat: add beta').click({ modifiers: ['ControlOrMeta'] })
  await expect(range).toContainText('2 commits · 2 changed files')
  await range.getByText('Open all changes together').click()
  await expect
    .poll(() => readCompareTabs(orcaPage))
    .toContainEqual({
      label: `Compare ${initial.slice(0, 7)} → ${tweak.slice(0, 7)}`,
      parentOid: initial,
      commitOid: tweak,
      paths: ['alpha.txt', 'beta.txt']
    })
})
