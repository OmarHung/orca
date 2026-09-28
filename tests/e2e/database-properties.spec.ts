import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  addServerConnection,
  addSqliteConnection,
  explorerMenu,
  openDatabasePage
} from './helpers/database-page'
import { adminSql } from './helpers/database-admin'
import { test, expect } from './helpers/orca-app'

const LONG_COLUMN = 'a_column_name_long_enough_that_the_explorer_has_to_scroll_sideways_to_show_it'

test('shows a SQLite database’s and table’s properties, and scrolls long names sideways', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-e2e-sqlite-'))
  registerPostElectronShutdownCleanup(async () => rmSync(dir, { recursive: true, force: true }))
  const filePath = join(dir, 'shop.db')
  const seed = new DatabaseSync(filePath)
  seed.exec(
    `pragma page_size = 8192;
     create table people (id integer primary key, ${LONG_COLUMN} text) strict;`
  )
  seed.close()

  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  await tree.getByRole('treeitem', { name: 'shop.db' }).dblclick()
  const main = tree.getByRole('treeitem', { name: 'main', exact: true })
  await expect(main).toBeVisible({ timeout: 20_000 })

  await explorerMenu(orcaPage, main, 'Properties…')
  const database = orcaPage.getByRole('dialog', { name: 'Properties of main' })
  await expect(database.getByText('Page size')).toBeVisible({ timeout: 20_000 })
  await expect(database).toContainText('8,192 bytes')
  await expect(database).toContainText('UTF-8')
  await orcaPage.screenshot({ path: testInfo.outputPath('database-properties.png') })
  await orcaPage.keyboard.press('Escape')
  await expect(database).toBeHidden()

  await main.dblclick()
  const people = tree.getByRole('treeitem', { name: 'people', exact: true })
  await explorerMenu(orcaPage, people, 'Properties…')
  const table = orcaPage.getByRole('dialog', { name: 'Properties of people' })
  await expect(table.getByText('STRICT', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(table.getByRole('table')).toContainText(LONG_COLUMN)
  await orcaPage.screenshot({ path: testInfo.outputPath('table-properties.png') })
  await orcaPage.keyboard.press('Escape')
  await expect(table).toBeHidden()

  // The whole name shows, and the tree scrolls sideways to it instead of cutting it short.
  // Why a key: double-clicking a table opens its data instead.
  await people.click()
  await orcaPage.keyboard.press('ArrowRight')
  const column = tree.getByRole('treeitem', { name: new RegExp(LONG_COLUMN) })
  await expect(column).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(() => tree.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true)
  await tree.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  // Its right edge is inside the scrolled tree, and nothing of it is clipped.
  const shown = await column.evaluate((row, text) => {
    const name = [...row.querySelectorAll('span')].find((span) => span.textContent === text)
    const scroller = row.closest('[role="tree"]')
    if (!name || !scroller) {
      return false
    }
    const clipped = name.scrollWidth > name.clientWidth
    return !clipped && name.getBoundingClientRect().right <= scroller.getBoundingClientRect().right
  }, LONG_COLUMN)
  expect(shown).toBe(true)
  await orcaPage.screenshot({ path: testInfo.outputPath('scrolled-tree.png') })
})

const POSTGRES_URL = process.env.ORCA_TEST_POSTGRES_URL

test('shows PostgreSQL comments in the tree, the column headers and Properties', async ({
  orcaPage
}, testInfo) => {
  test.skip(!POSTGRES_URL, 'set ORCA_TEST_POSTGRES_URL to a disposable PostgreSQL server')
  const schema = `orca_e2e_comments_${Date.now().toString(36)}`
  await adminSql(POSTGRES_URL!, [
    `create schema ${schema}`,
    `create table ${schema}.people (id int primary key, name text)`,
    `comment on table ${schema}.people is 'Everyone we know'`,
    `comment on column ${schema}.people.name is E'What they go by\\nshown first'`
  ])
  try {
    const connectionName = 'pg-comments'
    await openDatabasePage(orcaPage)
    await addServerConnection(orcaPage, { url: new URL(POSTGRES_URL!), name: connectionName })
    const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
    await tree.getByRole('treeitem', { name: connectionName }).dblclick()
    await tree.getByRole('treeitem', { name: schema }).dblclick()
    const people = tree.getByRole('treeitem', { name: /^people/ })
    await expect(people).toContainText('Everyone we know', { timeout: 20_000 })
    await people.click()
    await orcaPage.keyboard.press('ArrowRight')
    // One line in the tree; the title keeps the line break.
    const name = tree.getByRole('treeitem', { name: /^name/ })
    await expect(name).toContainText('What they go by shown first', { timeout: 20_000 })
    await expect(name.getByTitle('What they go by\nshown first')).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('tree-comments.png') })

    await explorerMenu(orcaPage, people, 'Open Data')
    const header = orcaPage.getByRole('columnheader', { name: /^name/ }).getByRole('button')
    await expect(header).toHaveAttribute('title', 'name\nWhat they go by\nshown first', {
      timeout: 20_000
    })

    await explorerMenu(orcaPage, people, 'Properties…')
    const properties = orcaPage.getByRole('dialog', { name: 'Properties of people' })
    await expect(properties.getByText('Everyone we know')).toBeVisible({ timeout: 20_000 })
    await expect(properties.getByText('Owner')).toBeVisible()
    await expect(properties.getByRole('table')).toContainText('shown first')
    await orcaPage.screenshot({ path: testInfo.outputPath('table-comments.png') })
  } finally {
    await adminSql(POSTGRES_URL!, [`drop schema if exists ${schema} cascade`])
  }
})
