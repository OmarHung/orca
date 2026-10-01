import type { Page } from '@playwright/test'
import { expect } from './orca-app'

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
export const BACK = process.platform === 'darwin' ? 'Meta+BracketLeft' : 'Control+Alt+ArrowLeft'
export const FORWARD =
  process.platform === 'darwin' ? 'Meta+BracketRight' : 'Control+Alt+ArrowRight'
export const WORD_RIGHT = process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight'

export async function openEditorFile(
  page: Page,
  root: string,
  relativePath: string,
  language: string
) {
  await page.evaluate(
    ({ root: rootPath, rel, lang }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (!state || !worktreeId) {
        throw new Error('no active worktree')
      }
      const separator = rootPath.includes('\\') ? '\\' : '/'
      state.openFile({
        filePath: `${rootPath}${separator}${rel.split('/').join(separator)}`,
        relativePath: rel,
        worktreeId,
        language: lang,
        mode: 'edit'
      })
    },
    { root, rel: relativePath, lang: language }
  )
}

/** Puts the cursor at the start of the first editor line containing `text`. */
export async function placeCursorOnLine(page: Page, text: string) {
  const line = page.locator('.monaco-editor .view-line', { hasText: text }).first()
  await expect(line).toBeVisible({ timeout: 30_000 })
  await line.click()
  await page.keyboard.press('Home')
}

export async function activeEditor(page: Page) {
  return page.evaluate(() => {
    const probe = window.__monacoEditorE2E
    const selection = probe?.snapshot().selection
    return {
      file: probe?.filePath.split(/[\\/]/).pop() ?? null,
      line: selection?.positionLineNumber ?? null,
      column: selection?.positionColumn ?? null
    }
  })
}
