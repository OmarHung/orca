import { addSqliteConnection, openDatabasePage } from './helpers/database-page'
import { seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

test('adds a connection from the list’s + button or its right-click menu', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  const dialog = orcaPage.getByRole('dialog', { name: 'New Connection' })
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })

  // Right-click on the list's empty space, below the rows.
  const box = await tree.boundingBox()
  await tree.click({ button: 'right', position: { x: 40, y: box!.height - 20 } })
  await orcaPage.getByRole('menuitem', { name: 'New Connection…' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  // A connection row keeps its own menu.
  await tree.getByRole('treeitem', { name: /^shop\.db/ }).click({ button: 'right' })
  await expect(orcaPage.getByRole('menuitem', { name: 'New Console' })).toBeVisible()
  await expect(orcaPage.getByRole('menuitem', { name: 'New Connection…' })).toHaveCount(0)
  await orcaPage.keyboard.press('Escape')

  const explorer = orcaPage.locator('div', { has: tree }).filter({ hasText: 'Connections' }).last()
  await explorer.getByRole('button', { name: 'New Connection' }).click()
  await expect(dialog).toBeVisible()
})
