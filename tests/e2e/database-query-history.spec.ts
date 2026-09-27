import { addSqliteConnection, openDatabasePage, runInConsole } from './helpers/database-page'
import { consoleText } from './helpers/database-console-assist'
import { expandPeople, seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

test('keeps console statements in query history, searches and reinserts them', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  const people = await expandPeople(orcaPage)
  await orcaPage.getByRole('button', { name: 'Open Console for shop.db' }).click()

  const grid = orcaPage.getByRole('grid')
  await runInConsole(orcaPage, 'select 1 as one;')
  await expect(grid.getByRole('columnheader', { name: /one/ })).toBeVisible({ timeout: 20_000 })
  await runInConsole(orcaPage, 'select name\nfrom people\nwhere id = 2;')
  await expect(grid.getByRole('gridcell', { name: 'Bob' })).toBeVisible({ timeout: 20_000 })
  await runInConsole(orcaPage, 'select * from nope;')
  await expect(orcaPage.getByText(/no such table: nope/)).toBeVisible({ timeout: 20_000 })
  // Running a statement again moves it to the top rather than listing it twice.
  await runInConsole(orcaPage, 'select 1 as one;')
  await expect(grid.getByRole('columnheader', { name: /one/ })).toBeVisible({ timeout: 20_000 })

  // Table browsing runs generated queries that don't belong in history.
  await people.dblclick()
  await expect(grid.getByRole('gridcell', { name: 'Ada' })).toBeVisible({ timeout: 20_000 })
  await orcaPage.getByRole('tab', { name: 'shop.db' }).click()

  await orcaPage.locator('.monaco-editor').first().click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  await orcaPage.keyboard.press('Backspace')
  await orcaPage.keyboard.press('ControlOrMeta+Alt+E')
  const history = orcaPage.getByRole('listbox', { name: 'Query History' })
  const items = history.getByRole('option')
  await expect(items).toHaveCount(3, { timeout: 10_000 })
  await expect(items.nth(0)).toContainText('select 1 as one')
  await expect(items.nth(1)).toContainText('select * from nope')
  await expect(items.nth(1).getByRole('img', { name: 'Failed' })).toBeVisible()
  await expect(items.nth(2)).toContainText('select name from people where id = 2')
  await expect(orcaPage.getByText('3 statements', { exact: true })).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('query-history.png') })

  await orcaPage.keyboard.type('people 2')
  await expect(items).toHaveCount(1)
  await orcaPage.keyboard.press('Enter')
  await expect(history).toBeHidden()
  await expect.poll(() => consoleText(orcaPage)).toBe('select name\nfrom people\nwhere id = 2')
  // The console has focus again, so Run works straight away.
  await orcaPage.keyboard.press('ControlOrMeta+Enter')
  await expect(grid.getByRole('gridcell', { name: 'Bob' })).toBeVisible({ timeout: 20_000 })

  await orcaPage.getByRole('button', { name: 'Query History' }).click()
  await expect(items).toHaveCount(3)
  await orcaPage.getByRole('button', { name: 'Clear History…' }).click()
  await expect(orcaPage.getByText('Clear 3 statements?')).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(orcaPage.getByText('Statements you run in consoles appear here.')).toBeVisible()
  await orcaPage.keyboard.press('Escape')
  await orcaPage.getByRole('button', { name: 'Query History' }).click()
  await expect(orcaPage.getByText('Statements you run in consoles appear here.')).toBeVisible()
})
