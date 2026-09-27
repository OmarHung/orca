import type { Page } from '@stablyai/playwright-test'
import { openDatabasePage, runInConsole } from './helpers/database-page'
import { test, expect } from './helpers/orca-app'

// Opt-in: a disposable PostgreSQL with trust auth, e.g. postgres://orca_test@127.0.0.1:55439/postgres
const TEST_URL = process.env.ORCA_TEST_POSTGRES_URL

test.describe('Database page', () => {
  test.skip(!TEST_URL, 'set ORCA_TEST_POSTGRES_URL to a disposable PostgreSQL server')

  test('connects to PostgreSQL, browses the schema and pages a query result', async ({
    orcaPage
  }, testInfo) => {
    const url = new URL(TEST_URL!)
    const database = url.pathname.slice(1)
    const connectionName = `${database}@${url.hostname}`
    await openDatabasePage(orcaPage)

    await orcaPage.getByRole('button', { name: 'New Connection' }).first().click()
    const dialog = orcaPage.getByRole('dialog')
    await dialog.getByLabel('Host').fill(url.hostname)
    await dialog.getByLabel('Port').fill(url.port)
    await dialog.getByLabel('Database', { exact: true }).fill(database)
    await dialog.getByLabel('User').fill(decodeURIComponent(url.username))
    await dialog.getByLabel('SSL mode').click()
    await orcaPage.getByRole('option', { name: 'disable' }).click()
    await dialog.getByRole('button', { name: 'Test Connection' }).click()
    await expect(dialog.getByText(/Connected to PostgreSQL/)).toBeVisible({ timeout: 20_000 })
    await orcaPage.screenshot({ path: testInfo.outputPath('database-connection-dialog.png') })
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
    await tree.getByRole('treeitem', { name: connectionName }).dblclick()
    await expect(tree.getByRole('treeitem', { name: 'public' })).toBeVisible({ timeout: 20_000 })

    await orcaPage.getByRole('button', { name: `Open Console for ${connectionName}` }).click()
    await runInConsole(
      orcaPage,
      'select n, n * 2 as doubled, n % 2 = 0 as even from generate_series(1, 1200) as n;'
    )

    const grid = orcaPage.getByRole('grid')
    await expect(grid.getByRole('columnheader', { name: /doubled/ })).toBeVisible({
      timeout: 20_000
    })
    await expect(orcaPage.getByText('500+ rows')).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('database-first-page.png') })

    // Scrolling to the end pulls the remaining pages through the open cursor.
    await expect(async () => {
      await grid.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
      await expect(orcaPage.getByText(/^1,?200 rows$/)).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 20_000 })

    await runInConsole(orcaPage, 'select * from missing_table;')
    await expect(orcaPage.getByText('relation "missing_table" does not exist')).toBeVisible({
      timeout: 20_000
    })
    // The server's error position becomes a marker under the offending word.
    await expect(orcaPage.locator('.monaco-editor .squiggly-error')).toHaveCount(1)
    await orcaPage.screenshot({ path: testInfo.outputPath('database-error.png') })
  })

  test('opens table data for reserved and mixed-case names, sorts and filters', async ({
    orcaPage
  }, testInfo) => {
    const url = new URL(TEST_URL!)
    const connectionName = `${url.pathname.slice(1)}@${url.hostname}`
    const schema = `e2e_${Date.now()}`
    await openDatabasePage(orcaPage)
    await addPostgresConnection(orcaPage, url)

    await orcaPage.getByRole('button', { name: `Open Console for ${connectionName}` }).click()
    await runInConsole(orcaPage, `create schema ${schema};`)
    await runInConsole(
      orcaPage,
      `create table ${schema}."user" ("order" int primary key, "Mixed Case" text);`
    )
    await runInConsole(
      orcaPage,
      `insert into ${schema}."user" values (1, 'a'), (2, null), (3, 'c');`
    )
    await expect(orcaPage.getByText(/^INSERT: 3 rows affected/)).toBeVisible({ timeout: 20_000 })

    const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
    await tree.getByRole('treeitem', { name: connectionName }).dblclick()
    await tree.getByRole('treeitem', { name: schema }).dblclick()
    await tree.getByRole('treeitem', { name: 'user' }).dblclick()

    const grid = orcaPage.getByRole('grid')
    await expect(grid.getByRole('columnheader', { name: /Mixed Case/ })).toBeVisible({
      timeout: 20_000
    })
    await expect(orcaPage.getByText(/^3 rows$/)).toBeVisible()

    const orderHeader = grid.getByRole('button', { name: /^order/ })
    await orderHeader.click()
    await expect(orcaPage.getByLabel('ORDER BY')).toHaveValue('"order" asc')
    await orderHeader.click()
    await expect(orcaPage.getByLabel('ORDER BY')).toHaveValue('"order" desc')
    await expect(grid.getByRole('row').nth(1)).toContainText('3', { timeout: 20_000 })

    await orcaPage.getByLabel('WHERE').fill('"Mixed Case" is not null')
    await orcaPage.getByLabel('WHERE').press('Enter')
    await expect(orcaPage.getByText(/^2 rows$/)).toBeVisible({ timeout: 20_000 })
    await orcaPage.screenshot({ path: testInfo.outputPath('database-table-data.png') })

    await orcaPage.getByRole('tab', { name: connectionName }).click()
    await runInConsole(orcaPage, `drop schema ${schema} cascade;`)
    await expect(orcaPage.getByText(/^DROP completed/)).toBeVisible({ timeout: 20_000 })
  })
})

async function addPostgresConnection(page: Page, url: URL): Promise<void> {
  const database = url.pathname.slice(1)
  await page.getByRole('button', { name: 'New Connection' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Host').fill(url.hostname)
  await dialog.getByLabel('Port').fill(url.port)
  await dialog.getByLabel('Database', { exact: true }).fill(database)
  await dialog.getByLabel('User').fill(decodeURIComponent(url.username))
  await dialog.getByLabel('SSL mode').click()
  await page.getByRole('option', { name: 'disable' }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}
