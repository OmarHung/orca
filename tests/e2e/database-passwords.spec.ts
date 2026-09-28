import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import {
  addServerConnection,
  explorerMenu,
  openDatabasePage,
  openDatabasePageWithShortcut
} from './helpers/database-page'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'

// Opt-in like the other PostgreSQL specs. The server must require passwords for roles
// named orca_pw_*, e.g. a first pg_hba.conf line:
//   host  all  /^orca_pw_  127.0.0.1/32  scram-sha-256
const ADMIN_URL = process.env.ORCA_TEST_POSTGRES_URL
const FIRST_PASSWORD = 'first-Pw-1'
const SECOND_PASSWORD = 'second-Pw-2'

async function adminQuery(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: ADMIN_URL })
  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }
}

function roleUrl(role: string, password?: string): URL {
  const url = new URL(ADMIN_URL!)
  url.username = role
  url.password = password ?? ''
  return url
}

async function rejectsWrongPassword(role: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: roleUrl(role, 'wrong-password').href })
  try {
    await client.connect()
    await client.end()
    return false
  } catch {
    return true
  }
}

/** A login role with FIRST_PASSWORD, dropped after the test. Skips when passwords aren't enforced. */
async function createPasswordRole(cleanup: (fn: () => Promise<void>) => void): Promise<string> {
  const role = `orca_pw_${Date.now().toString(36)}`
  await adminQuery(`create role ${role} login password '${FIRST_PASSWORD}'`)
  cleanup(() => adminQuery(`drop role if exists ${role}`))
  test.skip(
    !(await rejectsWrongPassword(role)),
    'the server does not require passwords for orca_pw_* roles (see the pg_hba.conf note)'
  )
  return role
}

function treeRow(page: Page, name: string) {
  return page.getByRole('tree', { name: 'Database objects' }).getByRole('treeitem', {
    name: new RegExp(`^${name}`)
  })
}

function schemaRows(page: Page) {
  return page.getByRole('tree', { name: 'Database objects' }).getByRole('treeitem', {
    name: 'public',
    exact: true
  })
}

test.describe('Database passwords', () => {
  test.skip(!ADMIN_URL, 'set ORCA_TEST_POSTGRES_URL to a disposable PostgreSQL server')

  test('asks for a "Never" password on every connect and keeps a rejected one in the prompt', async ({
    orcaPage,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    const role = await createPasswordRole(registerPostElectronShutdownCleanup)
    await openDatabasePage(orcaPage)
    await addServerConnection(orcaPage, {
      url: roleUrl(role, FIRST_PASSWORD),
      name: 'pw-never',
      passwordStorage: 'Never'
    })

    const row = treeRow(orcaPage, 'pw-never')
    const prompt = orcaPage.getByRole('dialog', { name: 'Password for pw-never' })
    await row.dblclick()
    await expect(prompt).toBeVisible({ timeout: 20_000 })

    await prompt.getByLabel('Password').fill('wrong-password')
    await prompt.getByRole('button', { name: 'Connect' }).click()
    await expect(prompt.getByText(/password authentication failed/)).toBeVisible({
      timeout: 20_000
    })
    await orcaPage.screenshot({ path: testInfo.outputPath('database-password-rejected.png') })

    await prompt.getByLabel('Password').fill(FIRST_PASSWORD)
    await prompt.getByRole('button', { name: 'Connect' }).click()
    await expect(prompt).toBeHidden({ timeout: 20_000 })
    await expect(schemaRows(orcaPage)).toBeVisible({ timeout: 20_000 })
    await expect(row.getByRole('img', { name: 'Connected' })).toBeVisible()

    await explorerMenu(orcaPage, row, 'Disconnect')
    await expect(schemaRows(orcaPage)).toBeHidden()
    await expect(row.getByRole('img', { name: 'Not connected' })).toBeVisible()
    await explorerMenu(orcaPage, row, 'Connect')
    await expect(prompt).toBeVisible({ timeout: 20_000 })
    await prompt.getByRole('button', { name: 'Cancel' }).click()
    await expect(prompt).toBeHidden()
  })

  test('keeps a saved password across restarts, forgets an "Until Orca quits" one, and re-asks when the server changes it', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
  {}, testInfo) => {
    test.setTimeout(300_000)
    const cleanups: (() => Promise<void>)[] = []
    const role = await createPasswordRole((fn) => cleanups.push(fn))
    const session = createRestartSession(testInfo)
    let app: ElectronApplication | null = null
    try {
      const first = await session.launch()
      app = first.app
      await openDatabasePageWithShortcut(first.page)
      await addServerConnection(first.page, {
        url: roleUrl(role, FIRST_PASSWORD),
        name: 'pw-saved',
        passwordStorage: 'Save securely'
      })
      await addServerConnection(first.page, {
        url: roleUrl(role, FIRST_PASSWORD),
        name: 'pw-session',
        passwordStorage: 'Until Orca quits'
      })
      await treeRow(first.page, 'pw-saved').dblclick()
      await treeRow(first.page, 'pw-session').dblclick()
      await expect(schemaRows(first.page)).toHaveCount(2, { timeout: 20_000 })
      await session.close(app)
      app = null

      // Only sealed ciphertext may reach the disk.
      for (const file of filesUnder(join(session.userDataDir, 'database'))) {
        expect(readFileSync(file, 'utf8'), file).not.toContain(FIRST_PASSWORD)
      }

      const second = await session.launch()
      app = second.app
      const page = second.page
      await waitForSessionReady(page)
      // The Database page was the active view at quit, so the relaunch reopens it.
      await expect(page.getByRole('heading', { name: 'Database' })).toBeVisible({
        timeout: 20_000
      })
      await treeRow(page, 'pw-saved').dblclick()
      await expect(schemaRows(page)).toHaveCount(1, { timeout: 20_000 })
      const sessionPrompt = page.getByRole('dialog', { name: 'Password for pw-session' })
      await treeRow(page, 'pw-session').dblclick()
      await expect(sessionPrompt).toBeVisible({ timeout: 20_000 })
      await sessionPrompt.getByRole('button', { name: 'Cancel' }).click()

      // The server stops accepting the saved password: connecting asks, and the new one is kept.
      await adminQuery(`alter role ${role} password '${SECOND_PASSWORD}'`)
      const savedRow = treeRow(page, 'pw-saved')
      const savedPrompt = page.getByRole('dialog', { name: 'Password for pw-saved' })
      await explorerMenu(page, savedRow, 'Disconnect')
      await explorerMenu(page, savedRow, 'Connect')
      await expect(savedPrompt).toBeVisible({ timeout: 20_000 })
      await savedPrompt.getByLabel('Password').fill(SECOND_PASSWORD)
      await savedPrompt.getByRole('button', { name: 'Connect' }).click()
      await expect(savedPrompt).toBeHidden({ timeout: 20_000 })
      await explorerMenu(page, savedRow, 'Disconnect')
      await explorerMenu(page, savedRow, 'Connect')
      await expect(savedRow.getByRole('img', { name: 'Connected' })).toBeVisible({
        timeout: 20_000
      })
      await expect(savedPrompt).toBeHidden()
      await page.screenshot({ path: testInfo.outputPath('database-password-restart.png') })
    } finally {
      if (app) {
        await session.close(app)
      }
      await session.dispose()
      for (const cleanup of cleanups) {
        await cleanup()
      }
    }
  })
})

const SQLSERVER_URL = process.env.ORCA_TEST_SQLSERVER_URL

test.describe('SQL Server passwords', () => {
  test.skip(!SQLSERVER_URL, 'set ORCA_TEST_SQLSERVER_URL to a disposable SQL Server')

  test('asks for the password when SQL Server refuses the login, and connects on a retry', async ({
    orcaPage
  }, testInfo) => {
    const url = new URL(SQLSERVER_URL!)
    await openDatabasePage(orcaPage)
    await addServerConnection(orcaPage, {
      url,
      type: 'SQL Server',
      name: 'mssql-never',
      passwordStorage: 'Never'
    })

    // With no password to send, SQL Server refuses the login (18456); that must open the prompt.
    const row = treeRow(orcaPage, 'mssql-never')
    const prompt = orcaPage.getByRole('dialog', { name: 'Password for mssql-never' })
    await row.dblclick()
    await expect(prompt).toBeVisible({ timeout: 30_000 })

    await prompt.getByLabel('Password').fill('wrong-password')
    await prompt.getByRole('button', { name: 'Connect' }).click()
    await expect(prompt.getByText(/Login failed for user/)).toBeVisible({ timeout: 30_000 })
    await orcaPage.screenshot({ path: testInfo.outputPath('sqlserver-password-rejected.png') })

    await prompt.getByLabel('Password').fill(decodeURIComponent(url.password))
    await prompt.getByRole('button', { name: 'Connect' }).click()
    await expect(prompt).toBeHidden({ timeout: 30_000 })
    await expect(row.getByRole('img', { name: 'Connected' })).toBeVisible({ timeout: 30_000 })
  })
})

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}
