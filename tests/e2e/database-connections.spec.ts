import { join } from 'node:path'
import {
  addSqliteConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

// Needs no server: every connection here is a SQLite file the test creates.
test('adds, tests, renames, reconnects and deletes a connection, and toggles the page by shortcut', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await electronApp.evaluate(({ dialog }, pickedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pickedPath] })
  }, filePath)
  await openDatabasePage(orcaPage)

  await orcaPage.getByRole('button', { name: 'New Connection' }).first().click()
  const dialog = orcaPage.getByRole('dialog', { name: 'New Connection' })
  await dialog.getByLabel('Type').click()
  await orcaPage.getByRole('option', { name: 'SQLite' }).click()
  const fileField = dialog.getByLabel('Database file')
  const missing = join(filePath, '..', 'missing.db')
  await fileField.fill(missing)
  await dialog.getByRole('button', { name: 'Test Connection' }).click()
  await expect(dialog.getByText(`SQLite file not found: ${missing}`)).toBeVisible({
    timeout: 20_000
  })

  // Browse… fills the path from the (stubbed) native file picker.
  await dialog.getByRole('button', { name: 'Browse…' }).click()
  await expect(fileField).toHaveValue(filePath)
  await dialog.getByLabel('Name').fill('shop')
  await dialog.getByRole('button', { name: 'Test Connection' }).click()
  await expect(dialog.getByText(/^Connected to SQLite 3\./)).toBeVisible({ timeout: 20_000 })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  await explorerMenu(orcaPage, tree.getByRole('treeitem', { name: /^shop/ }), 'Edit Connection…')
  const editDialog = orcaPage.getByRole('dialog', { name: 'Edit Connection' })
  await expect(editDialog.getByLabel('Database file')).toHaveValue(filePath)
  await editDialog.getByLabel('Name').fill('shop-renamed')
  await editDialog.getByRole('button', { name: 'Save' }).click()
  await expect(editDialog).toBeHidden()
  const row = tree.getByRole('treeitem', { name: /^shop-renamed/ })
  await expect(row).toBeVisible()
  await expect(tree.getByRole('treeitem')).toHaveCount(1)

  await row.dblclick()
  await expect(row.getByRole('img', { name: 'Connected' })).toBeVisible({ timeout: 20_000 })
  await explorerMenu(orcaPage, row, 'Disconnect')
  await expect(row.getByRole('img', { name: 'Not connected' })).toBeVisible()
  await explorerMenu(orcaPage, row, 'Connect')
  await expect(row.getByRole('img', { name: 'Connected' })).toBeVisible({ timeout: 20_000 })

  // Deleting a connection closes its console tabs too, as its dialog promises.
  await explorerMenu(orcaPage, row, 'New Console')
  await expect(orcaPage.getByRole('tab', { name: 'shop-renamed' })).toBeVisible()
  await explorerMenu(orcaPage, row, 'Delete Connection…')
  const deleteDialog = orcaPage.getByRole('dialog', { name: 'Delete shop-renamed?' })
  await orcaPage.screenshot({ path: testInfo.outputPath('database-delete-connection.png') })
  await deleteDialog.getByRole('button', { name: 'Delete' }).click()
  await expect(deleteDialog).toBeHidden()
  await expect(tree).toBeHidden()
  await expect(orcaPage.getByRole('tab', { name: 'shop-renamed' })).toBeHidden()
  await expect(orcaPage.getByText('No connections yet.')).toBeVisible()

  // Mod+Alt+D leaves the page for the previous view and comes back.
  await orcaPage.keyboard.press('ControlOrMeta+Alt+KeyD')
  await expect(orcaPage.getByRole('heading', { name: 'Database' })).toBeHidden()
  await orcaPage.keyboard.press('ControlOrMeta+Alt+KeyD')
  await expect(orcaPage.getByRole('heading', { name: 'Database' })).toBeVisible()
})

test('refuses writes on a read-only file, refreshes the explorer and runs caret, selection or all', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  const row = tree.getByRole('treeitem', { name: /^shop\.db/ })
  await explorerMenu(orcaPage, row, 'Edit Connection…')
  const editDialog = orcaPage.getByRole('dialog', { name: 'Edit Connection' })
  await editDialog.getByLabel('Read-only').click()
  await editDialog.getByRole('button', { name: 'Save' }).click()
  await expect(editDialog).toBeHidden()

  await explorerMenu(orcaPage, row, 'New Console')
  await runInConsole(orcaPage, "insert into people values (4, 'Di', null);")
  await expect(orcaPage.getByText('attempt to write a readonly database')).toBeVisible({
    timeout: 20_000
  })

  // Saving new settings drops the open session, so the next statement runs without read-only.
  await explorerMenu(orcaPage, row, 'Edit Connection…')
  await editDialog.getByLabel('Read-only').click()
  await editDialog.getByRole('button', { name: 'Save' }).click()
  await expect(editDialog).toBeHidden()
  await expect(row.getByRole('img', { name: 'Not connected' })).toBeVisible()
  await row.dblclick()
  const main = tree.getByRole('treeitem', { name: 'main', exact: true })
  await main.dblclick()
  await expect(tree.getByRole('treeitem', { name: 'people', exact: true })).toBeVisible({
    timeout: 20_000
  })

  // The explorer shows schema changes after a Refresh.
  await runInConsole(orcaPage, 'create table orders (id integer primary key);')
  await expect(orcaPage.getByText(/^CREATE completed/)).toBeVisible({ timeout: 20_000 })
  const orders = tree.getByRole('treeitem', { name: 'orders', exact: true })
  await expect(orders).toBeHidden()
  await explorerMenu(orcaPage, main, 'Refresh')
  await expect(orders).toBeVisible({ timeout: 20_000 })
  await runInConsole(orcaPage, 'drop table orders;')
  await expect(orcaPage.getByText(/^DROP completed/)).toBeVisible({ timeout: 20_000 })
  await explorerMenu(orcaPage, main, 'Refresh')
  await expect(orders).toBeHidden({ timeout: 20_000 })

  // The caret statement, a selection, or everything.
  const resultTabs = orcaPage.getByRole('tab', { name: /^Result \d+$/ })
  const grid = orcaPage.getByRole('grid')
  await runInConsole(orcaPage, 'select 1 as first;\nselect 2 as second;\nselect 3 as third;')
  await expect(grid.getByRole('columnheader', { name: /^third/ })).toBeVisible({ timeout: 20_000 })
  await expect(resultTabs).toHaveCount(1)

  await orcaPage.keyboard.press('ControlOrMeta+Shift+Enter')
  await expect(resultTabs).toHaveCount(3, { timeout: 20_000 })

  // The caret is at the end of line 3; select all of line 2.
  await orcaPage.keyboard.press('ArrowUp')
  await orcaPage.keyboard.press('Home')
  await orcaPage.keyboard.press('Shift+End')
  await orcaPage.keyboard.press('ControlOrMeta+Enter')
  await expect(resultTabs).toHaveCount(1, { timeout: 20_000 })
  await expect(grid.getByRole('columnheader', { name: /^second/ })).toBeVisible()
})
