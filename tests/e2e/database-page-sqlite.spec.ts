import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Locator, Page } from '@stablyai/playwright-test'
import { addSqliteConnection, openDatabasePage, runInConsole } from './helpers/database-page'
import { test, expect } from './helpers/orca-app'

/** A throwaway SQLite file with a small `people` table, removed after Electron shuts down. */
function seedShopDatabase(cleanup: (fn: () => Promise<void>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-e2e-sqlite-'))
  cleanup(async () => rmSync(dir, { recursive: true, force: true }))
  const filePath = join(dir, 'shop.db')
  const seed = new DatabaseSync(filePath)
  seed.exec(
    `create table people (id integer primary key, name text not null, profile text);
     insert into people values (1, 'Ada', '{"lang":"en","tags":["math"]}'), (2, 'Bob', null), (3, 'Cy', null)`
  )
  seed.close()
  return filePath
}

async function expandPeople(page: Page): Promise<Locator> {
  const tree = page.getByRole('tree', { name: 'Database objects' })
  await tree.getByRole('treeitem', { name: 'shop.db' }).dblclick()
  await tree.getByRole('treeitem', { name: 'main' }).dblclick()
  const people = tree.getByRole('treeitem', { name: 'people' })
  await expect(people).toBeVisible({ timeout: 20_000 })
  return people
}

// Needs no server: SQLite runs against a file this test creates.
test('opens a SQLite file, browses it, runs SQL and cancels a long statement', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  await expandPeople(orcaPage)

  await orcaPage.getByRole('button', { name: 'Open Console for shop.db' }).click()
  await runInConsole(orcaPage, 'select * from people order by id;')
  const grid = orcaPage.getByRole('grid')
  await expect(grid.getByRole('gridcell', { name: 'Cy' })).toBeVisible({ timeout: 20_000 })
  await expect(orcaPage.getByText(/^3 rows$/)).toBeVisible()

  // SQLite can't be interrupted in place; cancelling restarts its worker.
  await runInConsole(
    orcaPage,
    'with recursive s(n) as (select 1 union all select n + 1 from s where n < 1000000000) select count(*) from s;'
  )
  await orcaPage.waitForTimeout(500)
  await orcaPage.getByRole('button', { name: 'Cancel running statement' }).click()
  await expect(orcaPage.getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 20_000 })

  await runInConsole(orcaPage, 'select count(*) as total from people;')
  await expect(grid.getByRole('columnheader', { name: /total/ })).toBeVisible({ timeout: 20_000 })
  await orcaPage.screenshot({ path: testInfo.outputPath('sqlite-after-cancel.png') })
})

test('opens table data, filters, sorts on the server, counts and shows a value', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  await (await expandPeople(orcaPage)).dblclick()

  const grid = orcaPage.getByRole('grid')
  await expect(grid.getByRole('gridcell', { name: 'Ada' })).toBeVisible({ timeout: 20_000 })
  await expect(orcaPage.getByText(/^3 rows$/)).toBeVisible()

  const where = orcaPage.getByLabel('WHERE')
  await where.fill('id > 1')
  await where.press('Enter')
  await expect(grid.getByRole('gridcell', { name: 'Ada' })).toBeHidden({ timeout: 20_000 })
  await expect(orcaPage.getByText(/^2 rows$/)).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Count rows' }).click()
  await expect(orcaPage.getByText('2 total', { exact: true })).toBeVisible({ timeout: 20_000 })

  // Header clicks re-query with ORDER BY: ascending, then descending.
  const nameHeader = grid.getByRole('button', { name: /^name/ })
  const orderBy = orcaPage.getByLabel('ORDER BY')
  await nameHeader.click()
  await expect(orderBy).toHaveValue('name asc')
  await nameHeader.click()
  await expect(orderBy).toHaveValue('name desc')
  await expect(grid.getByRole('row').nth(1)).toContainText('Cy', { timeout: 20_000 })

  await where.fill('')
  await where.press('Enter')
  await grid.getByRole('gridcell', { name: /"lang"/ }).click()
  await grid.press('Shift+Enter')
  const viewer = orcaPage.getByRole('complementary', { name: 'Value viewer' })
  await expect(viewer).toContainText('"tags": [', { timeout: 20_000 })
  await orcaPage.screenshot({ path: testInfo.outputPath('sqlite-table-data.png') })
})
