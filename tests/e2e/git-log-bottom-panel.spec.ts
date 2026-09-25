import { execFileSync } from 'node:child_process'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const FIRST_SUBJECT = 'feat: git log first commit'
const SECOND_SUBJECT = 'fix: git log second commit'

test('opens the Git Log bottom panel and shows commit details', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const fixture = createGoldenWorktree(testRepoPath, 'git-log')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  for (const subject of [FIRST_SUBJECT, SECOND_SUBJECT]) {
    execFileSync('git', ['commit', '--allow-empty', '-m', `${subject}\n\nBody of ${subject}`], {
      cwd: fixture.worktreePath,
      stdio: 'pipe'
    })
  }

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)

  await orcaPage.getByTestId('git-log-status-toggle').click()
  const panel = orcaPage.getByTestId('bottom-panel')
  await expect(panel).toBeVisible()

  const rows = panel.getByTestId('git-log-row')
  await expect(rows.filter({ hasText: SECOND_SUBJECT })).toBeVisible({
    timeout: 20_000
  })
  await expect(rows.first()).toContainText(SECOND_SUBJECT)

  await rows.filter({ hasText: FIRST_SUBJECT }).click()
  await expect(panel.getByText(`Body of ${FIRST_SUBJECT}`)).toBeVisible()
  await orcaPage.screenshot({
    path: testInfo.outputPath('git-log-selected.png')
  })

  await panel.getByRole('textbox', { name: 'Text or hash' }).fill('second')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(SECOND_SUBJECT)

  await orcaPage.screenshot({
    path: testInfo.outputPath('git-log-filtered.png')
  })

  await panel.getByRole('button', { name: 'Hide bottom panel' }).click()
  await expect(panel).toBeHidden()
})

test('switches the Git Log between branches from the branch tree', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const fixture = createGoldenWorktree(testRepoPath, 'git-log-branches')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: fixture.worktreePath, stdio: 'pipe' })
  }
  const sideBranch = `${fixture.branchName}-side`
  git('commit', '--allow-empty', '-m', 'feat: on the workspace branch')
  git('branch', sideBranch, 'HEAD~1')
  git('commit', '--allow-empty', '-m', 'feat: second on the workspace branch')
  // Why a detached worktree-free commit: advance the side branch without checking it out.
  const sideTree = execFileSync('git', ['rev-parse', `${sideBranch}^{tree}`], {
    cwd: fixture.worktreePath
  })
    .toString()
    .trim()
  const sideCommit = execFileSync(
    'git',
    ['commit-tree', sideTree, '-p', sideBranch, '-m', 'feat: only on the side branch'],
    { cwd: fixture.worktreePath }
  )
    .toString()
    .trim()
  git('update-ref', `refs/heads/${sideBranch}`, sideCommit)

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.getByTestId('git-log-status-toggle').click()
  const panel = orcaPage.getByTestId('bottom-panel')
  const rows = panel.getByTestId('git-log-row')
  const tree = panel.getByTestId('git-log-branch-tree')

  await expect(rows.filter({ hasText: 'second on the workspace branch' })).toBeVisible({
    timeout: 20_000
  })
  await expect(rows.filter({ hasText: 'only on the side branch' })).toHaveCount(0)

  await tree.getByRole('textbox', { name: 'Branch' }).fill('-side')
  await tree.getByRole('button', { name: /-side$/ }).click()
  await expect(rows.filter({ hasText: 'only on the side branch' })).toBeVisible()
  await expect(rows.filter({ hasText: 'second on the workspace branch' })).toHaveCount(0)
  await expect(panel.getByTestId('git-log-scope-label')).toContainText(sideBranch)

  await tree.getByRole('textbox', { name: 'Branch' }).fill('')
  await tree.getByRole('button', { name: 'All Branches' }).click()
  await expect(rows.filter({ hasText: 'only on the side branch' })).toBeVisible()
  await expect(rows.filter({ hasText: 'second on the workspace branch' })).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('git-log-all-branches.png') })

  await tree.getByRole('button', { name: 'HEAD (Current Branch)' }).click()
  await expect(rows.filter({ hasText: 'only on the side branch' })).toHaveCount(0)
})
