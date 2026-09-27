import {
  addSqliteConnection,
  explorerMenu,
  openDatabasePage,
  typeInConsole
} from './helpers/database-page'
import { adminSqlite } from './helpers/database-admin'
import {
  consoleSuggestions,
  consoleText,
  moveCaretInLine,
  triggerSuggest
} from './helpers/database-console-assist'
import { expandPeople, seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

test('completes tables, alias columns and new tables, and reformats SQL', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  await expandPeople(orcaPage)
  await orcaPage.getByRole('button', { name: 'Open Console for shop.db' }).click()
  const suggestions = consoleSuggestions(orcaPage)

  await typeInConsole(orcaPage, 'select * from pe')
  await triggerSuggest(orcaPage)
  await expect(suggestions.first()).toContainText('people')
  await orcaPage.screenshot({ path: testInfo.outputPath('table-suggestions.png') })
  await orcaPage.keyboard.press('Enter')
  await expect.poll(() => consoleText(orcaPage)).toBe('select * from people')

  // `p.` resolves the alias declared later in the statement.
  await typeInConsole(orcaPage, 'select  from people p')
  await moveCaretInLine(orcaPage, 'select '.length)
  await orcaPage.keyboard.type('p.')
  await expect(suggestions).toHaveCount(3, { timeout: 10_000 })
  await expect(suggestions.nth(0)).toContainText('id')
  await expect(suggestions.nth(1)).toContainText('name')
  await expect(suggestions.nth(2)).toContainText('profile')
  await orcaPage.screenshot({ path: testInfo.outputPath('alias-columns.png') })
  await orcaPage.keyboard.press('Escape')

  // A refresh in the explorer picks up a table made elsewhere, for completion too.
  await adminSqlite(filePath, ['create table orders (id integer primary key, person_id integer)'])
  await explorerMenu(
    orcaPage,
    orcaPage
      .getByRole('tree', { name: 'Database objects' })
      .getByRole('treeitem', { name: 'main' }),
    'Refresh'
  )
  await typeInConsole(orcaPage, 'select * from ord')
  await triggerSuggest(orcaPage)
  await expect(suggestions.first()).toContainText('orders')
  await orcaPage.keyboard.press('Escape')

  await typeInConsole(orcaPage, 'select id,name from people where id=1;')
  await orcaPage.keyboard.press('ControlOrMeta+Alt+L')
  await expect
    .poll(() => consoleText(orcaPage))
    .toBe('select\n  id,\n  name\nfrom\n  people\nwhere\n  id = 1;')
  await orcaPage.screenshot({ path: testInfo.outputPath('reformatted.png') })

  await typeInConsole(orcaPage, '\\d people;\nselect 1')
  await orcaPage.keyboard.press('ControlOrMeta+Alt+L')
  await expect(orcaPage.getByText('Some SQL was left unformatted')).toBeVisible({
    timeout: 10_000
  })
  await expect.poll(() => consoleText(orcaPage)).toBe('\\d people;\nselect\n  1')
})
