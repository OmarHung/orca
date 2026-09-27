import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'

/** The active console's text; Monaco renders spaces as non-breaking ones. */
export async function consoleText(page: Page): Promise<string> {
  const lines = await page.locator('.monaco-editor .view-lines .view-line').allInnerTexts()
  return lines.join('\n').replace(/ /g, ' ')
}

export function consoleSuggestions(page: Page): Locator {
  return page.locator('.monaco-editor .suggest-widget .monaco-list-row')
}

/** Opens completion at the caret, as Ctrl+Space does on every platform. */
export async function triggerSuggest(page: Page): Promise<void> {
  await page.keyboard.press('Control+Space')
  await expect(consoleSuggestions(page).first()).toBeVisible({ timeout: 10_000 })
}

/** Moves the caret to `column` characters into the current line. */
export async function moveCaretInLine(page: Page, column: number): Promise<void> {
  await page.keyboard.press('Home')
  for (let index = 0; index < column; index += 1) {
    await page.keyboard.press('ArrowRight')
  }
}
