import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  addServerConnection,
  addSqliteConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { test, expect } from './helpers/orca-app'

test('shows a table’s keys and indexes, and no Routines folder for SQLite', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-e2e-sqlite-'))
  registerPostElectronShutdownCleanup(async () => rmSync(dir, { recursive: true, force: true }))
  const filePath = join(dir, 'shop.db')
  const seed = new DatabaseSync(filePath)
  seed.exec(
    `create table people (id integer primary key, name text not null);
     create table orders (id integer primary key, person_id integer not null references people (id), code text unique);
     create index orders_person_idx on orders (person_id);`
  )
  seed.close()

  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  await tree.getByRole('treeitem', { name: 'shop.db' }).dblclick()
  await tree.getByRole('treeitem', { name: 'main' }).dblclick()
  await tree.getByRole('treeitem', { name: 'orders' }).click()
  await orcaPage.keyboard.press('ArrowRight')
  await expect(tree.getByRole('treeitem', { name: 'Keys' })).toBeVisible({ timeout: 20_000 })
  await expect(tree.getByRole('treeitem', { name: 'Routines', exact: true })).toHaveCount(0)

  await tree.getByRole('treeitem', { name: 'Keys' }).dblclick()
  await expect(tree.getByRole('treeitem', { name: /^Primary key\s*\(id\)$/ })).toBeVisible({
    timeout: 20_000
  })
  await expect(tree.getByRole('treeitem', { name: /^Unique key\s*\(code\)$/ })).toBeVisible()
  await expect(
    tree.getByRole('treeitem', { name: /^Foreign key\s*\(person_id\) → people\(id\)$/ })
  ).toBeVisible()

  await tree.getByRole('treeitem', { name: 'Indexes' }).dblclick()
  await expect(
    tree.getByRole('treeitem', { name: /^orders_person_idx\s*\(person_id\)$/ })
  ).toBeVisible({
    timeout: 20_000
  })
  await expect(
    tree.getByRole('treeitem', { name: /^sqlite_autoindex_orders_1\s*\(code\) unique$/ })
  ).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('keys-and-indexes.png') })
})

const POSTGRES_URL = process.env.ORCA_TEST_POSTGRES_URL

test('lists a PostgreSQL schema’s functions and procedures under Routines', async ({
  orcaPage
}, testInfo) => {
  test.skip(!POSTGRES_URL, 'set ORCA_TEST_POSTGRES_URL to a disposable PostgreSQL server')
  const url = new URL(POSTGRES_URL!)
  const schema = `orca_e2e_routines_${Date.now().toString(36)}`
  await openDatabasePage(orcaPage)
  await addServerConnection(orcaPage, { url, name: 'pg-routines' })
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  const row = tree.getByRole('treeitem', { name: /^pg-routines/ })
  await explorerMenu(orcaPage, row, 'New Console')
  await runInConsole(orcaPage, `create schema ${schema};`)
  await expect(orcaPage.getByText(/^CREATE completed/).first()).toBeVisible({ timeout: 20_000 })
  await runInConsole(
    orcaPage,
    `create function ${schema}.add_one(i integer) returns integer language sql as 'select i + 1';`
  )
  await runInConsole(orcaPage, `create procedure ${schema}.noop() language sql as '';`)
  await expect(orcaPage.getByText(/^CREATE completed/)).toHaveCount(3, { timeout: 20_000 })

  try {
    // The console connected without expanding the tree, so this is its first load.
    await row.dblclick()
    await tree.getByRole('treeitem', { name: schema, exact: true }).dblclick()
    await tree.getByRole('treeitem', { name: 'Routines', exact: true }).dblclick()
    await expect(tree.getByRole('treeitem', { name: /^add_one\s*\(i integer\)$/ })).toBeVisible({
      timeout: 20_000
    })
    await expect(tree.getByRole('treeitem', { name: /^noop\s*\(\)$/ })).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('routines.png') })
  } finally {
    await runInConsole(orcaPage, `drop schema ${schema} cascade;`)
    await expect(orcaPage.getByText(/^DROP completed/)).toBeVisible({ timeout: 20_000 })
  }
})
