import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  GOLDEN_GIT_AUTHOR_EMAIL,
  GOLDEN_GIT_AUTHOR_NAME,
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const IDENTITY = [
  '-c',
  `user.name=${GOLDEN_GIT_AUTHOR_NAME}`,
  '-c',
  `user.email=${GOLDEN_GIT_AUTHOR_EMAIL}`
]

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
}

test('the status bar shows branch sync state and Fetch pulls in remote commits', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'branch-status')
  const remoteName = `e2e-upstream-${Date.now()}`
  const remoteDir = mkdtempSync(join(tmpdir(), 'orca-e2e-upstream-'))
  const cloneDir = mkdtempSync(join(tmpdir(), 'orca-e2e-upstream-clone-'))
  registerPostElectronShutdownCleanup(async () => {
    cleanupGoldenWorktree(testRepoPath, fixture)
    git(['remote', 'remove', remoteName], testRepoPath)
    rmSync(remoteDir, { recursive: true, force: true })
    rmSync(cloneDir, { recursive: true, force: true })
  })
  const worktree = fixture.worktreePath
  const branch = fixture.branchName

  git(['init', '--bare', remoteDir])
  git(['remote', 'add', remoteName, remoteDir], worktree)
  git(['push', remoteName, `HEAD:refs/heads/${branch}`], worktree)
  git(['branch', `--set-upstream-to=${remoteName}/${branch}`], worktree)
  // Someone else pushes a commit this worktree has not fetched yet.
  git(['clone', '--branch', branch, remoteDir, cloneDir])
  writeFileSync(join(cloneDir, 'remote.txt'), 'from a teammate\n')
  git(['add', 'remote.txt'], cloneDir)
  git([...IDENTITY, 'commit', '--no-verify', '-m', 'teammate change'], cloneDir)
  git(['push', 'origin', branch], cloneDir)
  // Locally: one commit to push and one uncommitted file.
  writeFileSync(join(worktree, 'local.txt'), 'mine\n')
  git(['add', 'local.txt'], worktree)
  git(['commit', '--no-verify', '-m', 'local change'], worktree)
  writeFileSync(join(worktree, 'draft.txt'), 'wip\n')

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, worktree)

  const segment = orcaPage.getByTestId('git-branch-status-segment')
  await expect(segment).toHaveAttribute(
    'aria-label',
    `Branch ${branch}, 1 to push, 0 to pull, 1 changed files`,
    { timeout: 30_000 }
  )

  await segment.click()
  const details = orcaPage.locator('[data-slot="popover-content"]')
  await expect(details.getByText(`Tracking ${remoteName}/${branch}`)).toBeVisible()
  await expect(details.getByText('1 commit to push')).toBeVisible()
  await expect(details.getByText('1 file with uncommitted changes')).toBeVisible()
  await expect(details.getByText('Auto fetch is off')).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('branch-status-before-fetch.png') })

  await details.getByRole('button', { name: 'Fetch' }).click()
  await expect(segment).toHaveAttribute(
    'aria-label',
    `Branch ${branch}, 1 to push, 1 to pull, 1 changed files`,
    { timeout: 30_000 }
  )
  await expect(details.getByText('1 commit to pull')).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('branch-status-after-fetch.png') })

  await orcaPage.evaluate(() =>
    window.__store?.getState().updateSettings({ gitBranchStatusBarEnabled: false })
  )
  await expect(segment).toBeHidden()
})
