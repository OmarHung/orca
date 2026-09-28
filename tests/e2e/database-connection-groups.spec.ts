import type { Locator } from '@stablyai/playwright-test'
import { addSqliteConnection, explorerMenu, openDatabasePage } from './helpers/database-page'
import { seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

/**
 * Drags `source` onto `target` and reports whether the target accepted it. Why synthetic events:
 * the hidden test window has no native drag loop.
 */
async function drag(source: Locator, target: Locator): Promise<boolean> {
  const sourceElement = await source.elementHandle()
  return target.evaluate((targetElement, dragged) => {
    const dataTransfer = new DataTransfer()
    const fire = (element: Element, type: string): boolean =>
      element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
    fire(dragged!, 'dragstart')
    const accepted = !fire(targetElement, 'dragover')
    if (accepted) {
      fire(targetElement, 'drop')
    }
    fire(dragged!, 'dragend')
    return accepted
  }, sourceElement)
}

test('files connections under groups from the dialog, the menu and by dragging', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const shopFile = seedShopDatabase(registerPostElectronShutdownCleanup)
  const archiveFile = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, shopFile)
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  const shop = tree.getByRole('treeitem', { name: /^shop\.db/ })

  // A connection saved with a group name starts that group.
  await orcaPage.getByRole('button', { name: 'New Connection' }).first().click()
  const dialog = orcaPage.getByRole('dialog', { name: 'New Connection' })
  await dialog.getByLabel('Type').click()
  await orcaPage.getByRole('option', { name: 'SQLite' }).click()
  await dialog.getByLabel('Database file').fill(archiveFile)
  await dialog.getByLabel('Name', { exact: true }).fill('archive')
  await dialog.getByLabel('Group', { exact: true }).fill('Local')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  const archive = tree.getByRole('treeitem', { name: /^archive/ })
  const local = tree.getByRole('treeitem', { name: /^Local/ })
  await expect(local).toHaveAttribute('aria-level', '1')
  await expect(archive).toHaveAttribute('aria-level', '2')

  // Moving a connected connection keeps its session and its open tree.
  await shop.dblclick()
  await expect(shop.getByRole('img', { name: 'Connected' })).toBeVisible({ timeout: 20_000 })
  await expect(tree.getByRole('treeitem', { name: /^main/ })).toBeVisible()
  await shop.click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Move to Group' }).click()
  await orcaPage.getByRole('menuitem', { name: 'Local', exact: true }).click()
  await expect(shop).toHaveAttribute('aria-level', '2')
  await expect(shop.getByRole('img', { name: 'Connected' })).toBeVisible()
  await expect(tree.getByRole('treeitem', { name: /^main/ })).toHaveAttribute('aria-level', '3')
  await orcaPage.screenshot({ path: testInfo.outputPath('grouped.png') })

  // Folding hides the group's connections.
  await local.dblclick()
  await expect(local).toHaveAttribute('aria-expanded', 'false')
  await expect(shop).toBeHidden()
  await local.dblclick()
  await expect(shop).toBeVisible()

  await explorerMenu(orcaPage, local, 'Rename Group…')
  const rename = orcaPage.getByRole('dialog', { name: 'Rename Group' })
  await rename.getByLabel('Group name').fill('Prod')
  await rename.getByRole('button', { name: 'Rename' }).click()
  await expect(rename).toBeHidden()
  const prod = tree.getByRole('treeitem', { name: /^Prod/ })
  await expect(prod).toBeVisible()
  await expect(local).toHaveCount(0)

  await explorerMenu(orcaPage, archive, 'Edit Connection…')
  const edit = orcaPage.getByRole('dialog', { name: 'Edit Connection' })
  await expect(edit.getByLabel('Group', { exact: true })).toHaveValue('Prod')
  await edit.getByRole('button', { name: 'Cancel' }).click()

  // Dropping outside the groups moves a connection to the top level; onto a group files it there.
  expect(await drag(archive, shop)).toBe(false)
  expect(await drag(archive, tree)).toBe(true)
  await expect(archive).toHaveAttribute('aria-level', '1')
  expect(await drag(archive, prod)).toBe(true)
  await expect(archive).toHaveAttribute('aria-level', '2')

  await explorerMenu(orcaPage, prod, 'Ungroup')
  await expect(prod).toHaveCount(0)
  await expect(shop).toHaveAttribute('aria-level', '1')
  await expect(archive).toHaveAttribute('aria-level', '1')
  await expect(shop.getByRole('img', { name: 'Connected' })).toBeVisible()
})
