import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

function openFile(page: Page, root: string, relativePath: string): Promise<void> {
  return page.evaluate(
    ({ absolute, relative }) => {
      const state = window.__store!.getState()
      state.openFile({
        filePath: absolute,
        relativePath: relative,
        worktreeId: state.activeWorktreeId!,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { absolute: path.join(root, relativePath), relative: relativePath }
  )
}

function pendingReveal(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__store!.getState().pendingExplorerReveal)
}

test('a reveal of a hidden file settles instead of waiting forever', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)
  const worktreePath = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    return Object.values(state.worktreesByRepo)
      .flat()
      .find((candidate) => candidate.id === state.activeWorktreeId)!.path
  })
  const created = [path.join(worktreePath, '.top-hidden'), path.join(worktreePath, 'shown')]
  mkdirSync(path.join(worktreePath, '.top-hidden'), { recursive: true })
  mkdirSync(path.join(worktreePath, 'shown', '.nested-hidden'), { recursive: true })
  writeFileSync(path.join(worktreePath, '.top-hidden', 'a.ts'), 'export {}\n')
  writeFileSync(path.join(worktreePath, 'shown', '.nested-hidden', 'b.ts'), 'export {}\n')
  writeFileSync(path.join(worktreePath, 'shown', 'visible.ts'), 'export {}\n')
  const row = (name: string) =>
    orcaPage
      .locator('[data-file-explorer-row]')
      .filter({ has: orcaPage.getByText(name, { exact: true }) })
  const locate = orcaPage.getByRole('button', { name: 'Locate Active File' })

  try {
    await expect(row('shown')).toBeVisible({ timeout: 10_000 })
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.toggleShowDotfilesForWorktree(state.activeWorktreeId!)
    })
    await expect(row('.top-hidden')).toHaveCount(0)

    // Hidden at the top: no row can stand in, and the reveal still ends.
    await openFile(orcaPage, worktreePath, '.top-hidden/a.ts')
    await locate.click()
    await expect.poll(() => pendingReveal(orcaPage)).toBeNull()

    // Hidden below a visible folder: that folder is selected instead.
    await openFile(orcaPage, worktreePath, 'shown/.nested-hidden/b.ts')
    await locate.click()
    await expect(row('shown')).toHaveAttribute('data-selected', 'true')
    await expect.poll(() => pendingReveal(orcaPage)).toBeNull()

    // A settled reveal no longer holds back automatic following.
    await openFile(orcaPage, worktreePath, 'shown/visible.ts')
    await expect(row('visible.ts')).toHaveAttribute('data-selected', 'true')

    // Showing dotfiles makes the same file reachable again.
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.toggleShowDotfilesForWorktree(state.activeWorktreeId!)
    })
    await openFile(orcaPage, worktreePath, 'shown/.nested-hidden/b.ts')
    await locate.click()
    await expect(row('b.ts')).toHaveAttribute('data-selected', 'true')
  } finally {
    for (const dir of created) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
