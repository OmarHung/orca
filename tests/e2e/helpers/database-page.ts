import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import { waitForSessionReady } from './store'

const PAGE_TITLES = { en: 'Database', 'zh-TW': '資料庫' } as const

/** Opens the Database page in English (or `language`), whatever the host locale is. */
export async function openDatabasePage(
  page: Page,
  language: keyof typeof PAGE_TITLES = 'en'
): Promise<void> {
  await waitForSessionReady(page)
  // Why: selectors are written in one language; the host locale would otherwise pick one.
  // The page mounts after this, so it renders in the new language.
  await page.evaluate(async (uiLanguage) => {
    await window.__store!.getState().updateSettings({ uiLanguage })
  }, language)
  await page.getByTestId('database-status-toggle').click()
  await expect(page.getByRole('heading', { name: PAGE_TITLES[language] })).toBeVisible()
}

/** Same as `openDatabasePage`, through the Mod+Alt+D shortcut instead of the status bar. */
export async function openDatabasePageWithShortcut(page: Page): Promise<void> {
  await waitForSessionReady(page)
  await page.evaluate(async () => {
    await window.__store!.getState().updateSettings({ uiLanguage: 'en' })
  })
  await page.keyboard.press('ControlOrMeta+Alt+KeyD')
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

export type ServerConnectionForm = {
  /** Host, port, database, user and (optional) password all come from the URL. */
  url: URL
  type?: 'PostgreSQL' | 'MySQL / MariaDB' | 'SQL Server'
  name?: string
  passwordStorage?: 'Save securely' | 'Until Orca quits' | 'Never'
  sslMode?: 'disable' | 'prefer' | 'require' | 'verify-full'
  readOnly?: boolean
  /** Label of a saved SSH host to tunnel through. */
  sshHost?: string
}

/** Fills the New Connection dialog for a server database, tests it and saves it. */
export async function addServerConnection(page: Page, form: ServerConnectionForm): Promise<void> {
  await page.getByRole('button', { name: 'New Connection' }).first().click()
  const dialog = page.getByRole('dialog')
  if (form.type && form.type !== 'PostgreSQL') {
    await dialog.getByLabel('Type').click()
    await page.getByRole('option', { name: form.type }).click()
  }
  if (form.name) {
    await dialog.getByLabel('Name').fill(form.name)
  }
  if (form.sshHost) {
    await dialog.getByLabel('SSH tunnel').click()
    await page.getByRole('option', { name: form.sshHost, exact: true }).click()
  }
  await dialog.getByLabel('Host').fill(form.url.hostname)
  await dialog.getByLabel('Port').fill(form.url.port)
  await dialog.getByLabel('Database', { exact: true }).fill(form.url.pathname.slice(1))
  await dialog.getByLabel('User').fill(decodeURIComponent(form.url.username))
  if (form.url.password) {
    await dialog.getByLabel('Password', { exact: true }).fill(decodeURIComponent(form.url.password))
  }
  if (form.passwordStorage) {
    await dialog.getByLabel('Save password').click()
    await page.getByRole('option', { name: form.passwordStorage }).click()
  }
  await dialog.getByLabel('SSL mode').click()
  await page.getByRole('option', { name: form.sslMode ?? 'disable', exact: true }).click()
  if (form.readOnly) {
    await dialog.getByLabel('Read-only').click()
  }
  await dialog.getByRole('button', { name: 'Test Connection' }).click()
  // Why longer through SSH: the first connect also opens the SSH session.
  await expect(dialog.getByText(/^Connected to /)).toBeVisible({
    timeout: form.sshHost ? 90_000 : 30_000
  })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

/** Opens a grid cell's in-place editor, types `value` and stages it with Enter. */
export async function editGridCell(
  page: Page,
  cell: Locator,
  column: string,
  value: string
): Promise<void> {
  await cell.dblclick()
  const editor = page.getByRole('textbox', { name: `Edit ${column}` })
  await editor.fill(value)
  await editor.press('Enter')
  await expect(editor).toBeHidden()
}

/** Right-clicks a row in the database explorer and picks a context menu item. */
export async function explorerMenu(page: Page, row: Locator, item: string): Promise<void> {
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/** Replaces the active console's text without running it. */
export async function typeInConsole(page: Page, sql: string): Promise<void> {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(sql)
}

/** Types into the active console, replacing its text, and runs the statement at the caret. */
export async function runInConsole(page: Page, sql: string): Promise<void> {
  await typeInConsole(page, sql)
  await page.keyboard.press('ControlOrMeta+Enter')
}
