import {
  addSqliteConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { expandPeople, seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

const RED = '#ef4444'

test('colors a connection’s explorer icon, tabs and toolbars without reconnecting', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  const people = await expandPeople(orcaPage)
  await orcaPage.getByRole('button', { name: 'Open Console for shop.db' }).click()
  await runInConsole(orcaPage, 'select 42 as answer;')
  const grid = orcaPage.getByRole('grid')
  await expect(grid.getByRole('gridcell', { name: '42' })).toBeVisible({ timeout: 20_000 })

  const toolbar = orcaPage.getByRole('button', { name: 'Run' }).locator('..')
  await expect(toolbar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  const row = tree.getByRole('treeitem', { name: /^shop\.db/ })
  await explorerMenu(orcaPage, row, 'Edit Connection…')
  const dialog = orcaPage.getByRole('dialog', { name: 'Edit Connection' })
  const colors = dialog.getByRole('group', { name: 'Color' })
  await expect(colors.getByRole('button', { name: 'No color' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  const red = colors.getByRole('button', { name: `Use color ${RED}` })
  await red.click()
  await expect(red).toHaveAttribute('aria-pressed', 'true')
  await orcaPage.screenshot({ path: testInfo.outputPath('color-field.png') })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  const consoleTab = orcaPage.getByRole('tab', { name: 'shop.db' })
  await expect(consoleTab).toHaveCSS('box-shadow', /rgb\(239, 68, 68\)/)
  await expect(row.locator('svg').nth(1)).toHaveCSS('color', 'rgb(239, 68, 68)')
  await expect(toolbar).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  // Color is cosmetic: the session and its results stay.
  await expect(grid.getByRole('gridcell', { name: '42' })).toBeVisible()
  await expect(row.getByRole('img', { name: 'Connected' })).toBeVisible()

  await people.dblclick()
  await expect(orcaPage.getByRole('tab', { name: 'people' })).toHaveCSS(
    'box-shadow',
    /rgb\(239, 68, 68\)/
  )
  await orcaPage.screenshot({ path: testInfo.outputPath('colored-connection.png') })

  await explorerMenu(orcaPage, row, 'Edit Connection…')
  await colors.getByRole('button', { name: 'No color' }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(orcaPage.getByRole('tab', { name: 'people' })).toHaveCSS('box-shadow', 'none')
})
