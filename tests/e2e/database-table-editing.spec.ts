import { DatabaseSync } from 'node:sqlite'
import type { Page } from '@stablyai/playwright-test'
import { addSqliteConnection, editGridCell, openDatabasePage } from './helpers/database-page'
import { expandPeople, seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

const ADA_PROFILE = '{"lang":"en","tags":["math"]}'

function peopleOnDisk(filePath: string): unknown[] {
  const database = new DatabaseSync(filePath, { readOnly: true })
  try {
    return database.prepare('select id, name, profile from people order by id').all()
  } finally {
    database.close()
  }
}

test('stages edits, previews and submits them in one transaction', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  await (await expandPeople(orcaPage)).dblclick()
  const grid = orcaPage.getByRole('grid')
  const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true })
  const submit = orcaPage.getByRole('button', { name: /^Submit \d+$/ })
  await expect(cell('Bob')).toBeVisible({ timeout: 20_000 })

  await editGridCell(orcaPage, cell('Bob'), 'name', 'Bobby')
  await expect(cell('Bobby')).toBeVisible()
  await expect(submit).toHaveText('Submit 1')

  // Esc leaves a cell as it was.
  await cell('Cy').dblclick()
  await orcaPage.getByRole('textbox', { name: 'Edit name' }).fill('nope')
  await orcaPage.getByRole('textbox', { name: 'Edit name' }).press('Escape')
  await expect(cell('Cy')).toBeVisible()

  // The context menu opens the same editor, and reverts a cell.
  await cell('Ada').click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Edit Value' }).click()
  const menuEditor = orcaPage.getByRole('textbox', { name: 'Edit name' })
  await menuEditor.fill('Ada L.')
  await menuEditor.press('Enter')
  await expect(submit).toHaveText('Submit 2')
  await cell('Ada L.').click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Revert Selected' }).click()
  await expect(cell('Ada')).toBeVisible()
  await expect(submit).toHaveText('Submit 1')

  await cell(ADA_PROFILE).click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Set to NULL' }).click()
  await expect(submit).toHaveText('Submit 2')

  await grid.getByRole('rowheader', { name: '3', exact: true }).click()
  await orcaPage.getByRole('button', { name: 'Delete Selected Rows' }).click()
  await expect(submit).toHaveText('Submit 3')

  // A new row opens its first cell for editing; untouched cells take the default.
  await orcaPage.getByRole('button', { name: 'Add Row' }).click()
  const idEditor = orcaPage.getByRole('textbox', { name: 'Edit id' })
  await idEditor.fill('4')
  await idEditor.press('Enter')
  await expect(grid.getByRole('gridcell', { name: 'DEFAULT' })).toHaveCount(2)
  await editGridCell(
    orcaPage,
    grid.getByRole('gridcell', { name: 'DEFAULT' }).first(),
    'name',
    'Di'
  )
  await expect(submit).toHaveText('Submit 4')
  await orcaPage.screenshot({ path: testInfo.outputPath('database-pending-edits.png') })

  await orcaPage.getByRole('button', { name: 'Preview SQL' }).click()
  const preview = orcaPage.getByRole('dialog', { name: 'Pending Changes' })
  await expect(preview).toContainText('DELETE FROM people WHERE id = 3;')
  await expect(preview).toContainText("UPDATE people SET name = 'Bobby' WHERE id = 2;")
  await expect(preview).toContainText('UPDATE people SET profile = NULL WHERE id = 1;')
  await expect(preview).toContainText("INSERT INTO people (id, name) VALUES (4, 'Di');")
  await orcaPage.screenshot({ path: testInfo.outputPath('database-preview-sql.png') })
  await preview.getByRole('button', { name: 'Submit' }).click()

  await expect(orcaPage.getByText('Saved 4 changes')).toBeVisible({ timeout: 20_000 })
  await expect(submit).toBeHidden()
  await expect(cell('Di')).toBeVisible({ timeout: 20_000 })
  await expect(cell('Cy')).toBeHidden()
  expect(peopleOnDisk(filePath)).toEqual([
    { id: 1, name: 'Ada', profile: null },
    { id: 2, name: 'Bobby', profile: null },
    { id: 4, name: 'Di', profile: null }
  ])
})

test('rolls back when a row changed underneath, and asks before discarding edits', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  const seed = new DatabaseSync(filePath)
  seed.exec("create table logs (message text); insert into logs values ('started')")
  seed.close()
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  await (await expandPeople(orcaPage)).dblclick()
  const grid = orcaPage.getByRole('grid')
  const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true })
  const submit = orcaPage.getByRole('button', { name: /^Submit \d+$/ })
  await expect(cell('Bob')).toBeVisible({ timeout: 20_000 })

  // Someone else deletes Bob after the rows were loaded.
  const other = new DatabaseSync(filePath)
  other.exec('delete from people where id = 2')
  other.close()
  await editGridCell(orcaPage, cell('Ada'), 'name', 'Ada L.')
  await editGridCell(orcaPage, cell('Bob'), 'name', 'Robert')
  await submit.click()
  await expect(orcaPage.getByText('Nothing was saved')).toBeVisible({ timeout: 20_000 })
  await expect(orcaPage.getByText(/Expected to change 1 row but changed 0/)).toBeVisible()
  await expect(submit).toHaveText('Submit 2')
  await orcaPage.screenshot({ path: testInfo.outputPath('database-submit-failed.png') })
  expect(peopleOnDisk(filePath)).toEqual([
    { id: 1, name: 'Ada', profile: ADA_PROFILE },
    { id: 3, name: 'Cy', profile: null }
  ])

  // Re-querying would drop the edits, so it asks first.
  const discard = orcaPage.getByRole('dialog', { name: 'Discard 2 unsaved changes?' })
  await orcaPage.getByRole('button', { name: 'Refresh' }).click()
  await discard.getByRole('button', { name: 'Keep Editing' }).click()
  await expect(submit).toHaveText('Submit 2')
  await orcaPage.getByRole('button', { name: 'Refresh' }).click()
  await discard.getByRole('button', { name: 'Discard' }).click()
  await expect(submit).toBeHidden()
  await expect(cell('Bob')).toBeHidden({ timeout: 20_000 })

  // Closing the tab asks too.
  await editGridCell(orcaPage, cell('Cy'), 'name', 'Cyrus')
  await orcaPage
    .getByRole('tab', { name: 'people' })
    .getByRole('button', { name: 'Close tab' })
    .click()
  await orcaPage
    .getByRole('dialog', { name: 'Discard 1 unsaved change?' })
    .getByRole('button', { name: 'Discard' })
    .click()
  await expect(orcaPage.getByRole('tab', { name: 'people' })).toBeHidden()

  // A table without a primary key stays read-only, and says why.
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  await explorerRefresh(orcaPage)
  await tree.getByRole('treeitem', { name: 'logs', exact: true }).dblclick()
  await expect(cell('started')).toBeVisible({ timeout: 20_000 })
  await expect(orcaPage.getByText('Read-only', { exact: true })).toBeVisible()
  await cell('started').dblclick()
  await expect(orcaPage.getByRole('textbox', { name: 'Edit message' })).toBeHidden()
})

async function explorerRefresh(page: Page): Promise<void> {
  const main = page
    .getByRole('tree', { name: 'Database objects' })
    .getByRole('treeitem', { name: 'main', exact: true })
  await main.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Refresh' }).click()
}
