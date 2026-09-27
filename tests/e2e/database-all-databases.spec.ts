import {
  addServerConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { test, expect } from './helpers/orca-app'

type ServerCase = {
  type: 'PostgreSQL' | 'SQL Server'
  url: string | undefined
  /** The database a connection naming none lands in. */
  home: string
  schema: string
  missingTable: RegExp
  /** Run one at a time: a console runs the statement at its caret. */
  dropDatabase: (name: string) => string[]
}

const CASES: ServerCase[] = [
  {
    type: 'PostgreSQL',
    url: process.env.ORCA_TEST_POSTGRES_URL,
    home: 'postgres',
    schema: 'public',
    missingTable: /relation "items" does not exist/,
    dropDatabase: (name) => [`drop database ${name} with (force);`]
  },
  {
    type: 'SQL Server',
    url: process.env.ORCA_TEST_SQLSERVER_URL,
    home: 'master',
    schema: 'dbo',
    missingTable: /Invalid object name 'items'/,
    dropDatabase: (name) => [
      `alter database ${name} set single_user with rollback immediate;`,
      `drop database ${name};`
    ]
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
    await openDatabasePage(orcaPage)
    await addServerConnection(orcaPage, { url, type: server.type, name })
    const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
    const row = tree.getByRole('treeitem', { name: new RegExp(`^${name}`) })
    await explorerMenu(orcaPage, row, 'New Console')
    await runInConsole(orcaPage, `create database ${database};`)
    await expect(orcaPage.getByText(/^CREATE completed/)).toBeVisible({ timeout: 30_000 })
    const databasePicker = orcaPage.getByRole('combobox', { name: 'Database' })
    await expect(databasePicker).toHaveText(server.home)

    try {
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
      await runInConsole(orcaPage, 'create table items (id int primary key);')
      await expect(orcaPage.getByText(/^CREATE completed/)).toBeVisible({ timeout: 30_000 })
      await runInConsole(orcaPage, 'insert into items values (1), (2);')
      await expect(orcaPage.getByText(/^INSERT: 2 rows affected/)).toBeVisible({ timeout: 30_000 })

      // The new database's objects are read from the database itself.
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
      // The first console, still in the home database.
      await orcaPage.getByRole('tab', { name }).first().click()
      for (const statement of server.dropDatabase(database)) {
        await runInConsole(orcaPage, statement)
        const keyword = statement.split(' ')[0]!.toUpperCase()
        await expect(orcaPage.getByText(new RegExp(`^${keyword} completed`))).toBeVisible({
          timeout: 30_000
        })
      }
    }
  })
}
