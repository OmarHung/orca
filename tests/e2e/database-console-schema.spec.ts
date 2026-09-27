import {
  addServerConnection,
  addSqliteConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

test('marks a read-only connection with a lock, and SQLite consoles have no schema picker', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  const row = tree.getByRole('treeitem', { name: /^shop\.db/ })
  await expect(row.getByRole('img', { name: 'Read-only' })).toHaveCount(0)

  await explorerMenu(orcaPage, row, 'Edit Connection…')
  const dialog = orcaPage.getByRole('dialog', { name: 'Edit Connection' })
  await dialog.getByRole('switch').click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(row.getByRole('img', { name: 'Read-only' })).toBeVisible()

  await explorerMenu(orcaPage, row, 'New Console')
  const toolbarBadge = orcaPage.getByRole('button', { name: 'Run' }).locator('..')
  await expect(toolbarBadge.getByRole('img', { name: 'Read-only' })).toBeVisible()
  await expect(orcaPage.getByRole('combobox', { name: /^(Database|Schema)$/ })).toHaveCount(0)
})

const MYSQL_URL = process.env.ORCA_TEST_MYSQL_URL

test('opens a console in the database it was opened from, and follows USE', async ({
  orcaPage
}, testInfo) => {
  test.skip(!MYSQL_URL, 'set ORCA_TEST_MYSQL_URL to a disposable MySQL server')
  // No default database, like a root@localhost connection.
  const url = new URL(MYSQL_URL!)
  const fallback = url.pathname.slice(1)
  url.pathname = '/'
  const database = `orca_e2e_schema_${Date.now().toString(36)}`
  await openDatabasePage(orcaPage)
  await addServerConnection(orcaPage, { url, type: 'MySQL / MariaDB', name: 'my-schema' })
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  const row = tree.getByRole('treeitem', { name: /^my-schema/ })
  await explorerMenu(orcaPage, row, 'New Console')
  const picker = orcaPage.getByRole('combobox', { name: 'Database' })
  await expect(picker).toHaveText('Choose database')
  await runInConsole(orcaPage, `create database ${database};`)
  await expect(orcaPage.getByText(/^CREATE completed/)).toBeVisible({ timeout: 20_000 })
  await runInConsole(orcaPage, `create table ${database}.items (id int primary key);`)
  await runInConsole(orcaPage, `insert into ${database}.items values (1), (2);`)
  await expect(orcaPage.getByText(/^INSERT: 2 rows affected/)).toBeVisible({ timeout: 20_000 })

  try {
    await row.dblclick()
    await explorerMenu(
      orcaPage,
      tree.getByRole('treeitem', { name: database, exact: true }),
      'New Console'
    )
    await expect(orcaPage.getByRole('tab', { name: 'my-schema (2)' })).toBeVisible()
    await expect(picker).toHaveText(database)
    const grid = orcaPage.getByRole('grid')
    await runInConsole(orcaPage, 'select count(*) as total from items;')
    await expect(grid.getByRole('gridcell', { name: '2', exact: true })).toBeVisible({
      timeout: 20_000
    })
    await orcaPage.screenshot({ path: testInfo.outputPath('database-picker.png') })

    // A USE typed in the console moves the picker with it.
    await runInConsole(orcaPage, `use ${fallback};`)
    await expect(picker).toHaveText(fallback, { timeout: 20_000 })
    await runInConsole(orcaPage, 'select count(*) as total from items;')
    await expect(orcaPage.getByText(/doesn't exist/)).toBeVisible({ timeout: 20_000 })

    await picker.click()
    await orcaPage.getByRole('option', { name: database, exact: true }).click()
    await expect(picker).toHaveText(database)
    await runInConsole(orcaPage, 'select count(*) as total from items;')
    await expect(grid.getByRole('gridcell', { name: '2', exact: true })).toBeVisible({
      timeout: 20_000
    })
  } finally {
    await runInConsole(orcaPage, `drop database ${database};`)
    await expect(orcaPage.getByText(/^DROP completed/)).toBeVisible({ timeout: 20_000 })
  }
})
