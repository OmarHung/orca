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

const FILES: Record<string, string> = {
  'shapes.ts': [
    'export const LIMIT = 3',
    'export class Circle {',
    '  radius = 1',
    '  area(): number {',
    '    return 3',
    '  }',
    '}',
    'export function render() {',
    '  return LIMIT',
    '}'
  ].join('\n'),
  'point.py': [
    'MAX_SIZE = 10',
    '',
    'class Point:',
    '    def __init__(self, x):',
    '        self.x = x',
    '',
    '    def move(self, dx):',
    '        return dx',
    '',
    'def main():',
    '    pass'
  ].join('\n'),
  'Repo.cs': [
    'namespace App;',
    '',
    'public class Repo',
    '{',
    '    public int Count { get; set; }',
    '    public void Save() { }',
    '    public void Save(string path) { }',
    '}'
  ].join('\n')
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  py: 'python',
  cs: 'csharp'
}

async function openEditorFile(page: Page, worktreePath: string, relativePath: string) {
  await page.evaluate(
    ({ root, rel, language }) => {
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
        language,
        mode: 'edit'
      })
    },
    {
      root: worktreePath,
      rel: relativePath,
      language: LANGUAGE_BY_EXTENSION[relativePath.split('.').at(-1) ?? ''] ?? 'plaintext'
    }
  )
}

test('the Structure tab outlines TypeScript, Python and C# files and jumps to symbols', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'code-outline')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  for (const [name, content] of Object.entries(FILES)) {
    writeFileSync(join(fixture.worktreePath, name), content)
  }

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await openEditorFile(orcaPage, fixture.worktreePath, 'shapes.ts')
  await orcaPage.evaluate(() => window.__store?.getState().setRightSidebarOpen(true))
  await orcaPage.getByRole('button', { name: 'Structure', exact: true }).click()

  const tree = orcaPage.getByRole('tree', { name: 'Structure' })
  await expect(tree.getByRole('treeitem', { name: 'Circle' })).toBeVisible({ timeout: 30_000 })
  await expect(tree.getByRole('treeitem')).toHaveText([
    'LIMIT',
    'Circle',
    'radius',
    'area',
    'render'
  ])

  // Clicking a symbol moves the editor cursor there, which the outline reflects as the current row.
  const area = tree.getByRole('treeitem', { name: 'area' })
  await area.click()
  await expect(area).toHaveAttribute('aria-selected', 'true')

  await openEditorFile(orcaPage, fixture.worktreePath, 'point.py')
  await expect(tree.getByRole('treeitem')).toHaveText(
    ['MAX_SIZE', 'Point', '__init__(self, x)', 'move(self, dx)', 'main()'],
    { timeout: 30_000 }
  )

  await orcaPage.getByRole('textbox', { name: 'Filter symbols' }).fill('mov')
  await expect(tree.getByRole('treeitem')).toHaveText(['Point', 'move(self, dx)'])
  await orcaPage.getByRole('button', { name: 'Clear filter' }).click()

  await openEditorFile(orcaPage, fixture.worktreePath, 'Repo.cs')
  await expect(tree.getByRole('treeitem')).toHaveText(
    ['App', 'Repo', 'Count', 'Save()', 'Save(string path)'],
    { timeout: 30_000 }
  )
})
