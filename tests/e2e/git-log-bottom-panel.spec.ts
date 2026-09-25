import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
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

test('toggles commit files between list and tree views', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const fixture = createGoldenWorktree(testRepoPath, 'git-log-files-tree')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const nestedDir = path.join(fixture.worktreePath, 'core', 'services')
  mkdirSync(nestedDir, { recursive: true })
  writeFileSync(path.join(nestedDir, 'MediaService.cs'), 'class MediaService {}\n')
  writeFileSync(path.join(nestedDir, 'FileStorage.cs'), 'class FileStorage {}\n')
  execFileSync('git', ['add', '.'], { cwd: fixture.worktreePath, stdio: 'pipe' })
  execFileSync('git', ['commit', '-m', 'feat: nested files'], {
    cwd: fixture.worktreePath,
    stdio: 'pipe'
  })

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.getByTestId('git-log-status-toggle').click()
  const panel = orcaPage.getByTestId('bottom-panel')
  await panel
    .getByTestId('git-log-row')
    .filter({ hasText: 'feat: nested files' })
    .click({ timeout: 20_000 })

  const files = panel.getByTestId('git-history-commit-file')
  await expect(files).toHaveCount(2)
  await expect(files.first()).toContainText('core/services')

  await panel.getByTestId('git-log-files-view-toggle').click()
  // Why compacted: a single-child folder chain renders as one `core/services` row.
  const folderRow = panel.getByRole('button', { name: 'core/services' })
  await expect(folderRow).toBeVisible()
  await expect(files.first()).not.toContainText('core/services')
  await orcaPage.screenshot({ path: testInfo.outputPath('git-log-files-tree.png') })

  await folderRow.click()
  await expect(files).toHaveCount(0)
})

test('resizes the branch tree, details pane, and message by dragging their edges', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  const fixture = createGoldenWorktree(testRepoPath, 'git-log-resize')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  execFileSync('git', ['commit', '--allow-empty', '-m', 'feat: resize target'], {
    cwd: fixture.worktreePath,
    stdio: 'pipe'
  })

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.getByTestId('git-log-status-toggle').click()
  const panel = orcaPage.getByTestId('bottom-panel')
  await panel
    .getByTestId('git-log-row')
    .filter({ hasText: 'feat: resize target' })
    .click({ timeout: 20_000 })

  const dragBy = async (label: string, dx: number, dy: number): Promise<void> => {
    const box = await panel.getByRole('separator', { name: label }).boundingBox()
    if (!box) {
      throw new Error(`no separator: ${label}`)
    }
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await orcaPage.mouse.move(x, y)
    await orcaPage.mouse.down()
    await orcaPage.mouse.move(x + dx, y + dy, { steps: 5 })
    await orcaPage.mouse.up()
  }
  const widthOf = async (testId: string): Promise<number> =>
    (await panel.getByTestId(testId).boundingBox())?.width ?? 0

  const treeBefore = await widthOf('git-log-branch-tree')
  await dragBy('Resize branch tree', 60, 0)
  await expect.poll(() => widthOf('git-log-branch-tree')).toBeGreaterThan(treeBefore + 40)

  const detailsBefore = await widthOf('git-log-commit-details')
  await dragBy('Resize commit details', -60, 0)
  await expect.poll(() => widthOf('git-log-commit-details')).toBeGreaterThan(detailsBefore + 40)

  const panelBefore = (await panel.boundingBox())?.height ?? 0
  // Why the panel first: at default height the files list's minimum leaves the message little room.
  await dragBy('Resize bottom panel', 0, -150)
  await expect
    .poll(async () => (await panel.boundingBox())?.height ?? 0)
    .toBeGreaterThan(panelBefore + 100)

  const message = panel.getByTestId('git-log-commit-message')
  const messageBefore = (await message.boundingBox())?.height ?? 0
  await dragBy('Resize commit message', 0, -30)
  await expect
    .poll(async () => (await message.boundingBox())?.height ?? 0)
    .toBeGreaterThan(messageBefore + 20)
})

test('resizes table columns by dragging and auto-fits them on double-click', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const fixture = createGoldenWorktree(testRepoPath, 'git-log-columns')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  execFileSync(
    'git',
    [
      '-c',
      'user.name=A Fairly Long Author Name',
      'commit',
      '--allow-empty',
      '-m',
      'feat: column target with a deliberately long subject line so the default subject column truncates it'
    ],
    { cwd: fixture.worktreePath, stdio: 'pipe' }
  )

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.getByTestId('git-log-status-toggle').click()
  const panel = orcaPage.getByTestId('bottom-panel')
  const authorCell = panel
    .getByTestId('git-log-row')
    .filter({ hasText: 'feat: column target' })
    .locator('[data-git-log-col="author"]')
  await expect(authorCell).toBeVisible({ timeout: 20_000 })
  const row = panel.getByTestId('git-log-row').filter({ hasText: 'feat: column target' })
  const dateCell = row.locator('[data-git-log-col="date"]')
  const handle = panel.getByRole('separator', { name: 'Resize Author column' })
  const boxOf = async (locator: typeof authorCell) => {
    const box = await locator.boundingBox()
    if (!box) {
      throw new Error('element has no box')
    }
    return box
  }
  const isTruncated = (locator: typeof authorCell) => (): Promise<boolean> =>
    locator.evaluate((element) => element.scrollWidth > element.clientWidth)

  await expect.poll(isTruncated(authorCell)).toBe(true)
  const authorBefore = await boxOf(authorCell)
  const dateBefore = await boxOf(dateCell)
  const handleBox = await boxOf(handle)
  // Why left of the cell's right edge: Excel resizes the column whose right border you drag.
  expect(handleBox.x).toBeGreaterThan(authorBefore.x + authorBefore.width - 4)
  await orcaPage.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await orcaPage.mouse.down()
  await orcaPage.mouse.move(
    handleBox.x + handleBox.width / 2 - 30,
    handleBox.y + handleBox.height / 2,
    { steps: 5 }
  )
  // Why before mouse.up: rows must follow the drag live, not only after release.
  await expect
    .poll(async () => (await boxOf(authorCell)).width)
    .toBeLessThan(authorBefore.width - 20)
  await orcaPage.mouse.up()
  const dateAfter = await boxOf(dateCell)
  // Columns to the right shift with the border and keep their own width.
  expect(dateAfter.x).toBeLessThan(dateBefore.x - 20)
  expect(Math.abs(dateAfter.width - dateBefore.width)).toBeLessThan(1)

  await handle.dblclick()
  await expect.poll(isTruncated(authorCell)).toBe(false)

  const subjectText = row.locator('[data-git-log-text]')
  await expect.poll(isTruncated(subjectText)).toBe(true)
  await panel.getByRole('separator', { name: 'Resize Subject column' }).dblclick()
  await expect.poll(isTruncated(subjectText)).toBe(false)
  await orcaPage.screenshot({ path: testInfo.outputPath('git-log-columns-fitted.png') })
})
