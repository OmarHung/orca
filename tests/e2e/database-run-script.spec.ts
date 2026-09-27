import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  addServerConnection,
  addSqliteConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { expandPeople, seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'

/** Makes the next native open dialog return `paths`. */
async function stubPicker(electronApp: ElectronApplication, paths: string[]): Promise<void> {
  await electronApp.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: picked })
  }, paths)
}

async function runScriptFrom(
  page: Page,
  options: { keepGoing?: boolean; transaction?: boolean } = {}
): Promise<void> {
  const row = page
    .getByRole('tree', { name: 'Database objects' })
    .getByRole('treeitem', { name: /^shop\.db/ })
  await explorerMenu(page, row, 'Run SQL Script…')
  const dialog = page.getByRole('dialog', { name: 'Run SQL Script' })
  await dialog.getByRole('button', { name: 'Choose Files…' }).click()
  await expect(dialog.getByRole('list', { name: 'Script files' })).toBeVisible()
  if (options.keepGoing) {
    await dialog.getByLabel('When a statement fails').click()
    await page.getByRole('option', { name: 'Keep going and list the errors' }).click()
  }
  if (options.transaction) {
    await dialog.getByRole('switch').click()
  }
  await dialog.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('runs SQL script files in numbered order, reporting errors and rolling back a failed transaction', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  const dir = dirname(filePath)
  const script = (name: string, text: string): string => {
    writeFileSync(join(dir, name), text)
    return join(dir, name)
  }
  const tables = script(
    '1_tables.sql',
    "create table orders (id integer primary key, item text);\ninsert into orders values (1, 'a;b');\n"
  )
  const more = script('10_more.sql', "insert into orders values (2, 'c');\n")
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  await expandPeople(orcaPage)

  // Picked out of order; `1_` must still run before `10_`.
  await stubPicker(electronApp, [more, tables])
  const row = orcaPage
    .getByRole('tree', { name: 'Database objects' })
    .getByRole('treeitem', { name: /^shop\.db/ })
  await explorerMenu(orcaPage, row, 'Run SQL Script…')
  const dialog = orcaPage.getByRole('dialog', { name: 'Run SQL Script' })
  await dialog.getByRole('button', { name: 'Choose Files…' }).click()
  const files = dialog.getByRole('list', { name: 'Script files' }).getByRole('listitem')
  await expect(files).toHaveText([/1_tables\.sql/, /10_more\.sql/])
  await orcaPage.screenshot({ path: testInfo.outputPath('run-script-dialog.png') })
  await dialog.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(orcaPage.getByText('Script finished. Statements run: 3')).toBeVisible({
    timeout: 20_000
  })
  // The tree picks up what the script created.
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  await expect(tree.getByRole('treeitem', { name: 'orders', exact: true })).toBeVisible({
    timeout: 20_000
  })

  // Keep going past a failure, and list it with its file and line.
  await stubPicker(electronApp, [
    script(
      'errors.sql',
      "insert into orders values (3, 'd');\ninsert into nowhere values (1);\ninsert into orders values (4, 'e');\n"
    )
  ])
  await runScriptFrom(orcaPage, { keepGoing: true })
  await expect(orcaPage.getByText('Script finished with errors (1)')).toBeVisible({
    timeout: 20_000
  })
  await orcaPage.getByRole('button', { name: 'Jobs' }).click()
  const jobs = orcaPage.getByRole('list', { name: 'Background jobs' })
  await expect(jobs.getByText('errors.sql:2')).toBeVisible()
  await expect(jobs.getByText('no such table: nowhere')).toBeVisible()
  await expect(jobs.getByText(/^Statements: 2 · Errors: 1/)).toBeVisible()
  // Why wait: the popover fades in; a screenshot mid-fade is unreadable.
  await orcaPage.waitForTimeout(400)
  await orcaPage.screenshot({ path: testInfo.outputPath('run-script-jobs.png') })
  await orcaPage.keyboard.press('Escape')

  // In one transaction, a failure undoes everything before it.
  await stubPicker(electronApp, [
    script('atomic.sql', "insert into orders values (5, 'f');\ninsert into nowhere values (1);\n")
  ])
  await runScriptFrom(orcaPage, { transaction: true })
  await expect(orcaPage.getByText('Script finished with errors (1)')).toHaveCount(2, {
    timeout: 20_000
  })
  await explorerMenu(orcaPage, row, 'New Console')
  await runInConsole(orcaPage, 'select count(*) as total from orders;')
  await expect(
    orcaPage.getByRole('grid').getByRole('gridcell', { name: '4', exact: true })
  ).toBeVisible({
    timeout: 20_000
  })
})

const POSTGRES_URL = process.env.ORCA_TEST_POSTGRES_URL

test('shows a running script’s progress and cancels it from the Jobs list', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.skip(!POSTGRES_URL, 'set ORCA_TEST_POSTGRES_URL to a disposable PostgreSQL server')
  const dir = dirname(seedShopDatabase(registerPostElectronShutdownCleanup))
  const slow = join(dir, 'slow.sql')
  writeFileSync(slow, 'select 1;\nselect pg_sleep(60);\nselect 2;\n')
  await openDatabasePage(orcaPage)
  await addServerConnection(orcaPage, { url: new URL(POSTGRES_URL!), name: 'pg-script' })
  const row = orcaPage
    .getByRole('tree', { name: 'Database objects' })
    .getByRole('treeitem', { name: /^pg-script/ })
  await stubPicker(electronApp, [slow])
  await explorerMenu(orcaPage, row, 'Run SQL Script…')
  const dialog = orcaPage.getByRole('dialog', { name: 'Run SQL Script' })
  await dialog.getByRole('button', { name: 'Choose Files…' }).click()
  await dialog.getByRole('button', { name: 'Run', exact: true }).click()

  await orcaPage.getByRole('button', { name: 'Jobs (1 running)' }).click()
  const jobs = orcaPage.getByRole('list', { name: 'Background jobs' })
  await expect(jobs.getByText(/^File 1 of 1 · Statements: 1 · Errors: 0/)).toBeVisible({
    timeout: 20_000
  })
  await expect(jobs.getByRole('progressbar')).toBeVisible()
  await orcaPage.waitForTimeout(400)
  await orcaPage.screenshot({ path: testInfo.outputPath('run-script-running.png') })
  await jobs.getByRole('button', { name: 'Cancel' }).click()
  await expect(orcaPage.getByText('Script cancelled. Statements run: 1')).toBeVisible({
    timeout: 15_000
  })
  await expect(orcaPage.getByRole('button', { name: 'Jobs', exact: true })).toBeVisible()
})
