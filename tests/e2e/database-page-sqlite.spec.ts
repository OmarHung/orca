import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabasePage, runInConsole } from './helpers/database-page'
import { test, expect } from './helpers/orca-app'

// Needs no server: SQLite runs against a file this test creates.
test('opens a SQLite file, browses it, runs SQL and cancels a long statement', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-e2e-sqlite-'))
  registerPostElectronShutdownCleanup(async () => rmSync(dir, { recursive: true, force: true }))
  const filePath = join(dir, 'shop.db')
  const seed = new DatabaseSync(filePath)
  seed.exec(
    "create table people (id integer primary key, name text not null); insert into people values (1, 'Ada'), (2, 'Bob'), (3, 'Cy')"
  )
  seed.close()

  await openDatabasePage(orcaPage)
  await orcaPage.getByRole('button', { name: 'New Connection' }).first().click()
  const dialog = orcaPage.getByRole('dialog')
  await dialog.getByLabel('Type').click()
  await orcaPage.getByRole('option', { name: 'SQLite' }).click()
  await dialog.getByLabel('Database file').fill(filePath)
  await dialog.getByRole('button', { name: 'Test Connection' }).click()
  await expect(dialog.getByText(/Connected to SQLite 3\./)).toBeVisible({ timeout: 20_000 })
  await orcaPage.screenshot({ path: testInfo.outputPath('sqlite-connection-dialog.png') })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  await tree.getByRole('treeitem', { name: 'shop.db' }).dblclick()
  await tree.getByRole('treeitem', { name: 'main' }).dblclick()
  await expect(tree.getByRole('treeitem', { name: 'people' })).toBeVisible({ timeout: 20_000 })

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
