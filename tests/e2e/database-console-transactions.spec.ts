import type { Page } from '@stablyai/playwright-test'
import {
  addServerConnection,
  addSqliteConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { expandPeople, seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

async function setTransactionMode(page: Page, mode: 'Auto-commit' | 'Manual commit') {
  await page.getByRole('combobox', { name: 'Transaction mode' }).click()
  await page.getByRole('option', { name: mode }).click()
  // Focus goes back to the console, so typing right away lands in the editor.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('.monaco-editor') !== null))
    .toBe(true)
}

async function expectPeopleCount(page: Page, count: number): Promise<void> {
  await runInConsole(page, 'select count(*) as total from people;')
  await expect(
    page.getByRole('grid').getByRole('gridcell', { name: String(count), exact: true })
  ).toBeVisible({
    timeout: 20_000
  })
}

function consoleTab(page: Page) {
  return page.getByRole('tab', { name: 'shop.db' })
}

test('holds manual-commit changes until Commit or Roll Back, and asks before closing', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  await expandPeople(orcaPage)
  const openConsole = orcaPage.getByRole('button', { name: 'Open Console for shop.db' })
  await openConsole.click()

  const open = orcaPage.getByText('Transaction open', { exact: true })
  const commit = orcaPage.getByRole('button', { name: 'Commit', exact: true })
  const rollBack = orcaPage.getByRole('button', { name: 'Roll Back', exact: true })
  const mode = orcaPage.getByRole('combobox', { name: 'Transaction mode' })

  await setTransactionMode(orcaPage, 'Manual commit')
  await expect(commit).toBeDisabled()
  await runInConsole(orcaPage, "insert into people values (4, 'Dee', null);")
  await expect(open).toBeVisible({ timeout: 20_000 })
  await expect(commit).toBeEnabled()
  // Leaving manual mode would strand or commit the transaction, so it waits for Commit or Roll Back.
  await expect(mode).toBeDisabled()
  await orcaPage.screenshot({ path: testInfo.outputPath('transaction-open.png') })

  await rollBack.click()
  await expect(open).toBeHidden({ timeout: 20_000 })
  await expect(orcaPage.getByText(/^ROLLBACK completed/)).toBeVisible()
  await expectPeopleCount(orcaPage, 3)

  await runInConsole(orcaPage, "insert into people values (4, 'Dee', null);")
  await expect(open).toBeVisible({ timeout: 20_000 })
  await commit.click()
  await expect(open).toBeHidden({ timeout: 20_000 })
  await expect(mode).toBeEnabled()

  // In manual mode even a read opens a transaction; closing then asks what to do with it.
  await expectPeopleCount(orcaPage, 4)
  await expect(open).toBeVisible()
  await consoleTab(orcaPage).getByRole('button', { name: 'Close tab' }).click()
  const dialog = orcaPage.getByRole('dialog', { name: 'Close with an open transaction?' })
  await expect(dialog).toBeVisible()
  // Let the open animation finish so the screenshot shows the dialog, not its fade-in.
  await orcaPage.waitForTimeout(300)
  await orcaPage.screenshot({ path: testInfo.outputPath('close-with-transaction.png') })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(consoleTab(orcaPage)).toBeVisible()

  await runInConsole(orcaPage, "insert into people values (5, 'Eve', null);")
  await consoleTab(orcaPage).getByRole('button', { name: 'Close tab' }).click()
  await dialog.getByRole('button', { name: 'Roll Back and Close' }).click()
  await expect(consoleTab(orcaPage)).toBeHidden()

  // A new console starts in auto-commit and sees only what was committed.
  await openConsole.click()
  await expect(mode).toHaveText('Auto-commit')
  await expectPeopleCount(orcaPage, 4)
  await expect(open).toBeHidden()

  await setTransactionMode(orcaPage, 'Manual commit')
  await runInConsole(orcaPage, "insert into people values (5, 'Eve', null);")
  await consoleTab(orcaPage).getByRole('button', { name: 'Close tab' }).click()
  await dialog.getByRole('button', { name: 'Commit and Close' }).click()
  await expect(consoleTab(orcaPage)).toBeHidden()
  await openConsole.click()
  await expectPeopleCount(orcaPage, 5)
})

const POSTGRES_URL = process.env.ORCA_TEST_POSTGRES_URL

test('marks a PostgreSQL transaction that an error aborted until it is rolled back', async ({
  orcaPage
}, testInfo) => {
  test.skip(!POSTGRES_URL, 'set ORCA_TEST_POSTGRES_URL to a disposable PostgreSQL server')
  const url = new URL(POSTGRES_URL!)
  await openDatabasePage(orcaPage)
  await addServerConnection(orcaPage, { url, name: 'pg-tx' })
  const row = orcaPage
    .getByRole('tree', { name: 'Database objects' })
    .getByRole('treeitem', { name: /^pg-tx/ })
  await explorerMenu(orcaPage, row, 'New Console')

  await setTransactionMode(orcaPage, 'Manual commit')
  await runInConsole(orcaPage, 'select 1/0;')
  await expect(orcaPage.getByText('division by zero').first()).toBeVisible({ timeout: 20_000 })
  await expect(orcaPage.getByText('Transaction failed — roll back')).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: 'Commit', exact: true })).toBeDisabled()
  await orcaPage.screenshot({ path: testInfo.outputPath('transaction-failed.png') })
  await orcaPage.getByRole('button', { name: 'Roll Back', exact: true }).click()
  await expect(orcaPage.getByText('Transaction failed — roll back')).toBeHidden({ timeout: 20_000 })
})
