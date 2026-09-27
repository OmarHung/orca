import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { addSqliteConnection, explorerMenu, openDatabasePage } from './helpers/database-page'
import { test, expect } from './helpers/orca-app'

/** A SQLite file with the given schema, in a folder removed after Electron shuts down. */
function seedDatabase(
  cleanup: (fn: () => Promise<void>) => void,
  sql: string
): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'orca-e2e-dump-'))
  cleanup(async () => rmSync(dir, { recursive: true, force: true }))
  const filePath = join(dir, 'shop.db')
  const seed = new DatabaseSync(filePath)
  seed.exec(sql)
  seed.close()
  return { dir, filePath }
}

const SHOP = `
  create table people (id integer primary key, name text not null);
  create table orders (id integer primary key, person_id integer not null references people (id), code text);
  insert into people values (1, 'Ada'), (2, 'Bob''s');
  insert into orders values (10, 1, 'a1'), (11, 2, null);
  create view people_view as select id, name from people;
`

/** Makes the next native save or folder dialog answer `path`. */
async function stubDialogs(electronApp: ElectronApplication, path: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, picked) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: picked })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, path)
}

function connectionRow(page: Page) {
  return page
    .getByRole('tree', { name: 'Database objects' })
    .getByRole('treeitem', { name: /^shop\.db/ })
}

function rowsOf(filePath: string, sql: string): unknown[] {
  const database = new DatabaseSync(filePath, { readOnly: true })
  try {
    return database.prepare(sql).all()
  } finally {
    database.close()
  }
}

test('dumps a SQLite database to one SQL file that loads into an empty one', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const { dir, filePath } = seedDatabase(registerPostElectronShutdownCleanup, SHOP)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)

  await explorerMenu(orcaPage, connectionRow(orcaPage), 'Dump to SQL…')
  const dialog = orcaPage.getByRole('dialog', { name: 'Dump to SQL' })
  const objects = dialog.getByRole('list', { name: 'Objects' })
  await expect(objects.getByRole('checkbox', { name: 'people_view' })).toBeChecked({
    timeout: 20_000
  })
  await expect(dialog.getByText('Selected: 3 of 3')).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('dump-dialog.png') })

  const target = join(dir, 'shop-dump.sql')
  await stubDialogs(electronApp, target)
  await dialog.getByRole('button', { name: 'Save As…' }).click()
  await expect(dialog).toBeHidden()
  await expect(orcaPage.getByText('Dump saved')).toBeVisible({ timeout: 20_000 })

  const restored = join(dir, 'restored.db')
  const database = new DatabaseSync(restored)
  database.exec(readFileSync(target, 'utf8'))
  database.close()
  expect(rowsOf(restored, 'select * from orders order by id')).toEqual(
    rowsOf(filePath, 'select * from orders order by id')
  )
  expect(rowsOf(restored, 'select * from people_view order by id')).toEqual([
    { id: 1, name: 'Ada' },
    { id: 2, name: "Bob's" }
  ])

  await orcaPage.getByRole('button', { name: 'Jobs' }).click()
  const job = orcaPage.getByRole('list', { name: 'Background jobs' }).getByRole('listitem')
  await expect(job).toContainText('Dump of shop.db')
  await expect(job).toContainText('Tables: 2 · Rows: 4')
  // Lets the popover finish fading in before the screenshot.
  await orcaPage.waitForTimeout(300)
  await orcaPage.screenshot({ path: testInfo.outputPath('dump-jobs.png') })
})

test('exports one table’s rows into a new folder with a file per table', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}) => {
  const { dir, filePath } = seedDatabase(registerPostElectronShutdownCleanup, SHOP)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  await connectionRow(orcaPage).dblclick()
  await tree.getByRole('treeitem', { name: 'main' }).dblclick()
  const people = tree.getByRole('treeitem', { name: 'people', exact: true })
  await expect(people).toBeVisible({ timeout: 20_000 })

  await explorerMenu(orcaPage, people, 'Export Data…')
  const dialog = orcaPage.getByRole('dialog', { name: 'Export Data' })
  // Views hold no rows of their own, so only tables are offered; only this one is checked.
  await expect(dialog.getByText('Selected: 1 of 2')).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByRole('checkbox', { name: 'people_view' })).toHaveCount(0)
  await dialog.getByLabel('Files').click()
  await orcaPage.getByRole('option', { name: 'One file per table' }).click()

  await stubDialogs(electronApp, dir)
  await dialog.getByRole('button', { name: 'Choose Folder…' }).click()
  await expect(orcaPage.getByText('Dump saved')).toBeVisible({ timeout: 20_000 })

  const folder = readdirSync(dir).find((name) => name.startsWith('people-data-'))
  expect(folder).toBeDefined()
  const files = readdirSync(join(dir, folder!)).sort()
  const text = files.map((name) => readFileSync(join(dir, folder!, name), 'utf8')).join('\n')
  expect(files.some((name) => name.includes('main.people'))).toBe(true)
  expect(text).toMatch(/INSERT INTO people/)
  expect(text).not.toMatch(/CREATE TABLE|INSERT INTO orders/)
})

test('cancels a running dump and removes what it wrote', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}) => {
  const { dir, filePath } = seedDatabase(
    registerPostElectronShutdownCleanup,
    `create table events (id integer primary key, note text);
     with recursive n(i) as (select 1 union all select i + 1 from n where i < 2000000)
     insert into events select i, 'event ' || i from n;`
  )
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)

  await explorerMenu(orcaPage, connectionRow(orcaPage), 'Dump to SQL…')
  const dialog = orcaPage.getByRole('dialog', { name: 'Dump to SQL' })
  await expect(dialog.getByText('Selected: 1 of 1')).toBeVisible({ timeout: 20_000 })
  await dialog.getByLabel('Rows per INSERT').fill('1')
  const target = join(dir, 'slow.sql')
  await stubDialogs(electronApp, target)
  await dialog.getByRole('button', { name: 'Save As…' }).click()

  await orcaPage.getByRole('button', { name: /^Jobs \(1 running\)$/ }).click()
  const job = orcaPage.getByRole('list', { name: 'Background jobs' }).getByRole('listitem')
  await expect(job).toContainText(/Rows: [1-9]/, { timeout: 20_000 })
  await job.getByRole('button', { name: 'Cancel' }).click()
  await expect(orcaPage.getByText('Dump cancelled; nothing was saved')).toBeVisible({
    timeout: 20_000
  })
  await expect(job).toContainText('Cancelled; its files were removed.')
  expect(existsSync(target)).toBe(false)
})
