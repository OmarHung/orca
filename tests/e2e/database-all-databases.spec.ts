import {
  addServerConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { adminSql } from './helpers/database-admin'
import { test, expect } from './helpers/orca-app'

type ServerCase = {
  type: 'PostgreSQL' | 'SQL Server'
  url: string | undefined
  /** The database a connection naming none lands in. */
  home: string
  schema: string
  missingTable: RegExp
  /** Creates `name` holding `items` (1, 2), on a writable connection of the test's own. */
  seed: (url: string, name: string) => Promise<void>
  drop: (url: string, name: string) => Promise<void>
}

const CASES: ServerCase[] = [
  {
    type: 'PostgreSQL',
    url: process.env.ORCA_TEST_POSTGRES_URL,
    home: 'postgres',
    schema: 'public',
    missingTable: /relation "items" does not exist/,
    seed: async (url, name) => {
      await adminSql(url, [`create database ${name}`])
      await adminSql(
        url,
        ['create table items (id int primary key)', 'insert into items values (1), (2)'],
        { database: name }
      )
    },
    drop: (url, name) => adminSql(url, [`drop database if exists ${name} with (force)`])
  },
  {
    type: 'SQL Server',
    url: process.env.ORCA_TEST_SQLSERVER_URL,
    home: 'master',
    schema: 'dbo',
    missingTable: /Invalid object name 'items'/,
    seed: (url, name) =>
      adminSql(url, [
        `create database ${name}`,
        `create table ${name}.dbo.items (id int primary key)`,
        `insert into ${name}.dbo.items values (1), (2)`
      ]),
    drop: (url, name) =>
      adminSql(url, [
        `alter database ${name} set single_user with rollback immediate`,
        `drop database ${name}`
      ])
  }
]

for (const server of CASES) {
  test(`lists every ${server.type} database when the connection names none`, async ({
    orcaPage
  }, testInfo) => {
    test.skip(!server.url, `set the ${server.type} test URL to a disposable server`)
    test.setTimeout(180_000)
    const url = new URL(server.url!)
    url.pathname = '/'
    const database = `orca_e2e_all_${Date.now().toString(36)}`
    const name = `all-${server.type === 'PostgreSQL' ? 'pg' : 'mssql'}`
    await server.seed(server.url!, database)
    try {
      await openDatabasePage(orcaPage)
      await addServerConnection(orcaPage, { url, type: server.type, name })
      const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
      const row = tree.getByRole('treeitem', { name: new RegExp(`^${name}`) })
      await explorerMenu(orcaPage, row, 'New Console')
      await runInConsole(orcaPage, 'select 1;')
      const databasePicker = orcaPage.getByRole('combobox', { name: 'Database' })
      await expect(databasePicker).toHaveText(server.home, { timeout: 30_000 })

      await row.dblclick()
      await expect(tree.getByRole('treeitem', { name: server.home, exact: true })).toBeVisible({
        timeout: 30_000
      })
      const databaseRow = tree.getByRole('treeitem', { name: database, exact: true })
      await explorerMenu(orcaPage, databaseRow, 'New Console')
      await expect(orcaPage.getByRole('tab', { name: `${name} (2)` })).toBeVisible()
      await expect(databasePicker).toHaveText(database)
      if (server.type === 'PostgreSQL') {
        await expect(orcaPage.getByRole('combobox', { name: 'Schema' })).toHaveText('public', {
          timeout: 30_000
        })
      }

      // The other database's objects are read from the database itself.
      await databaseRow.dblclick()
      await tree.getByRole('treeitem', { name: server.schema, exact: true }).dblclick()
      const items = tree.getByRole('treeitem', { name: 'items', exact: true })
      await explorerMenu(orcaPage, items, 'Open Data')
      await expect(orcaPage.getByRole('tab', { name: 'items' })).toBeVisible()
      const grid = orcaPage.getByRole('grid')
      await expect(grid.getByRole('gridcell', { name: '2', exact: true })).toBeVisible({
        timeout: 30_000
      })
      await orcaPage.screenshot({ path: testInfo.outputPath('all-databases.png') })

      // The console's picker moves it between databases.
      await orcaPage.getByRole('tab', { name: `${name} (2)` }).click()
      await databasePicker.click()
      await orcaPage.getByRole('option', { name: server.home, exact: true }).click()
      await expect(databasePicker).toHaveText(server.home)
      await runInConsole(orcaPage, 'select count(*) as total from items;')
      await expect(orcaPage.getByText(server.missingTable)).toBeVisible({ timeout: 30_000 })
      await databasePicker.click()
      await orcaPage.getByRole('option', { name: database, exact: true }).click()
      await runInConsole(orcaPage, 'select count(*) as total from items;')
      await expect(grid.getByRole('gridcell', { name: '2', exact: true })).toBeVisible({
        timeout: 30_000
      })
    } finally {
      await server.drop(server.url!, database)
    }
  })
}
