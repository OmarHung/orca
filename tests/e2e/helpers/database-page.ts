import type { Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import { waitForSessionReady } from './store'

/** Opens the Database page with English copy, whatever the host locale is. */
export async function openDatabasePage(page: Page): Promise<void> {
  await waitForSessionReady(page)
  // Why: the selectors are English; a zh-TW host locale would otherwise pick zh-TW.
  // The page mounts after this, so it renders in the new language.
  await page.evaluate(async () => {
    await window.__store!.getState().updateSettings({ uiLanguage: 'en' })
  })
  await page.getByTestId('database-status-toggle').click()
  await expect(page.getByRole('heading', { name: 'Database' })).toBeVisible()
}

/** Types into the active console's Monaco editor, replacing its text, and runs it. */
export async function runInConsole(page: Page, sql: string): Promise<void> {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(sql)
  await page.keyboard.press('ControlOrMeta+Enter')
}
