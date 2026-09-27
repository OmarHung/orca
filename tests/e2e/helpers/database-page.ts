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

/** Saves a SQLite connection for `filePath` through the connection dialog. */
export async function addSqliteConnection(page: Page, filePath: string): Promise<void> {
  await page.getByRole('button', { name: 'New Connection' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Type').click()
  await page.getByRole('option', { name: 'SQLite' }).click()
  await dialog.getByLabel('Database file').fill(filePath)
  await dialog.getByRole('button', { name: 'Test Connection' }).click()
  await expect(dialog.getByText(/Connected to SQLite 3\./)).toBeVisible({ timeout: 20_000 })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

/** Types into the active console's Monaco editor, replacing its text, and runs it. */
export async function runInConsole(page: Page, sql: string): Promise<void> {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(sql)
  await page.keyboard.press('ControlOrMeta+Enter')
}
