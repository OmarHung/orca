import {
  addServerConnection,
  addSqliteConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole,
  typeInConsole
} from './helpers/database-page'
import { adminSql } from './helpers/database-admin'
import { consoleSuggestions, triggerSuggest } from './helpers/database-console-assist'
import { seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

test('has no read-only switch to set, and SQLite consoles have no schema picker', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  const row = orcaPage
    .getByRole('tree', { name: 'Database objects' })
    .getByRole('treeitem', { name: /^shop\.db/ })

  // Every connection is read-only, so there is nothing to switch.
  await explorerMenu(orcaPage, row, 'Edit Connection…')
  const dialog = orcaPage.getByRole('dialog', { name: 'Edit Connection' })
  await expect(dialog.getByLabel('Database file')).toBeVisible()
  await expect(dialog.getByRole('switch')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  await explorerMenu(orcaPage, row, 'New Console')
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
  await adminSql(MYSQL_URL!, [
    `create database ${database}`,
    `create table ${database}.items (id int primary key)`,
    `insert into ${database}.items values (1), (2)`
  ])
  try {
    await openDatabasePage(orcaPage)
    await addServerConnection(orcaPage, { url, type: 'MySQL / MariaDB', name: 'my-schema' })
    const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
    const row = tree.getByRole('treeitem', { name: /^my-schema/ })
    await explorerMenu(orcaPage, row, 'New Console')
    const picker = orcaPage.getByRole('combobox', { name: 'Database' })
    await expect(picker).toHaveText('Choose database')
    // Completion reads only while connected.
    await runInConsole(orcaPage, 'select 1;')
    await expect(orcaPage.getByRole('grid')).toBeVisible({ timeout: 20_000 })
    // With no database current, FROM offers databases to pick from.
    const suggestions = consoleSuggestions(orcaPage)
    await typeInConsole(orcaPage, 'select * from ')
    await triggerSuggest(orcaPage)
    await expect(suggestions.filter({ hasText: database })).toHaveCount(1)
    await orcaPage.keyboard.press('Escape')

    await row.dblclick()
    await explorerMenu(
      orcaPage,
      tree.getByRole('treeitem', { name: database, exact: true }),
      'New Console'
    )
    await expect(orcaPage.getByRole('tab', { name: 'my-schema (2)' })).toBeVisible()
    await expect(picker).toHaveText(database)
    // With one picked, FROM needs no database name: only its tables are offered.
    await typeInConsole(orcaPage, 'select * from it')
    await triggerSuggest(orcaPage)
    await expect(suggestions).toHaveCount(1)
    await expect(suggestions.first()).toContainText('items')
    await orcaPage.keyboard.press('Escape')
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
    await adminSql(MYSQL_URL!, [`drop database if exists ${database}`])
  }
})

const SQLSERVER_URL = process.env.ORCA_TEST_SQLSERVER_URL

test('switches a SQL Server console between databases, and follows USE', async ({
  orcaPage
}, testInfo) => {
  test.skip(!SQLSERVER_URL, 'set ORCA_TEST_SQLSERVER_URL to a disposable SQL Server')
  const url = new URL(SQLSERVER_URL!)
  const database = `orca_e2e_db_${Date.now().toString(36)}`
  await adminSql(url, [
    `create database ${database}`,
    `create table ${database}.dbo.items (id int primary key)`,
    `insert into ${database}.dbo.items values (1), (2)`
  ])
  try {
    await openDatabasePage(orcaPage)
    await addServerConnection(orcaPage, { url, type: 'SQL Server', name: 'mssql-dbs' })
    const row = orcaPage
      .getByRole('tree', { name: 'Database objects' })
      .getByRole('treeitem', { name: /^mssql-dbs/ })
    await explorerMenu(orcaPage, row, 'New Console')
    await runInConsole(orcaPage, 'select 1;')

    const picker = orcaPage.getByRole('combobox', { name: 'Database' })
    await expect(picker).toHaveText('master', { timeout: 30_000 })
    await picker.click()
    await orcaPage.getByRole('option', { name: database, exact: true }).click()
    await expect(picker).toHaveText(database)
    const grid = orcaPage.getByRole('grid')
    await runInConsole(orcaPage, 'select count(*) as total from items;')
    await expect(grid.getByRole('gridcell', { name: '2', exact: true })).toBeVisible({
      timeout: 30_000
    })
    await orcaPage.screenshot({ path: testInfo.outputPath('sqlserver-database-picker.png') })

    await runInConsole(orcaPage, 'use master;')
    await expect(picker).toHaveText('master', { timeout: 30_000 })
  } finally {
    await adminSql(url, [
      `alter database ${database} set single_user with rollback immediate`,
      `drop database ${database}`
    ])
  }
})
