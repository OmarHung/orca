import type { Page } from '@stablyai/playwright-test'
import {
  addServerConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole,
  typeInConsole
} from './helpers/database-page'
import {
  consoleSuggestions,
  moveCaretInLine,
  triggerSuggest
} from './helpers/database-console-assist'
import { test, expect } from './helpers/orca-app'

// Opt-in per server, with the same URLs as the driver integration tests, e.g.
//   ORCA_TEST_MYSQL_URL=mysql://root:pw@127.0.0.1:53306/orca_it
//   ORCA_TEST_SQLSERVER_URL=sqlserver://sa:pw@127.0.0.1:51433/master

type DriverCase = {
  label: string
  env: string
  type: 'MySQL / MariaDB' | 'SQL Server'
  schema: (url: URL) => string
  createTable: (table: string) => string
  /** Statements that leave `callTwoSets` returning two result sets, run with Mod+Shift+Enter. */
  twoSetsSetup: (name: string) => string
  callTwoSets: (name: string) => string
  dropTwoSets: (name: string) => string
  sleep: string
  readOnlyRefusal: RegExp
}

const MYSQL_CASE: Omit<DriverCase, 'label' | 'env'> = {
  type: 'MySQL / MariaDB',
  schema: (url) => url.pathname.slice(1),
  createTable: (table) => `create table ${table} (id int primary key, label varchar(20))`,
  twoSetsSetup: (name) =>
    `DELIMITER //\ncreate procedure ${name}() begin select 1 as first; select 2 as second; end //\nDELIMITER ;`,
  callTwoSets: (name) => `call ${name}();`,
  dropTwoSets: (name) => `drop procedure ${name};`,
  sleep: 'select sleep(30) as slept;',
  readOnlyRefusal: /READ ONLY transaction/
}

const CASES: DriverCase[] = [
  { label: 'mysql', env: 'ORCA_TEST_MYSQL_URL', ...MYSQL_CASE },
  { label: 'mariadb', env: 'ORCA_TEST_MARIADB_URL', ...MYSQL_CASE },
  {
    label: 'sqlserver',
    env: 'ORCA_TEST_SQLSERVER_URL',
    type: 'SQL Server',
    schema: () => 'dbo',
    createTable: (table) => `create table ${table} (id int primary key, label nvarchar(20));`,
    // Why no setup: one batch with two SELECTs already returns two result sets.
    twoSetsSetup: () => '',
    callTwoSets: () => 'select 1 as first\nselect 2 as second',
    dropTwoSets: () => '',
    sleep: "waitfor delay '00:00:30';",
    readOnlyRefusal:
      /This connection is read-only, so Orca did not run a statement containing INSERT/
  }
]

async function runAll(page: Page, sql: string): Promise<void> {
  await typeInConsole(page, sql)
  await page.keyboard.press('ControlOrMeta+Shift+Enter')
}

for (const driver of CASES) {
  const rawUrl = process.env[driver.env]
  test.describe(`Database page with ${driver.label}`, () => {
    test.skip(!rawUrl, `set ${driver.env} to a disposable server`)

    test('connects, returns two result sets, cancels, opens table data and refuses read-only writes', async ({
      orcaPage
    }, testInfo) => {
      test.setTimeout(180_000)
      const url = new URL(rawUrl!)
      const suffix = Date.now().toString(36)
      const table = `orca_e2e_${suffix}`
      const routine = `orca_e2e_sets_${suffix}`
      const schema = driver.schema(url)
      await openDatabasePage(orcaPage)
      await addServerConnection(orcaPage, { url, type: driver.type, name: `rw-${driver.label}` })
      const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
      const row = tree.getByRole('treeitem', { name: new RegExp(`^rw-${driver.label}`) })

      await explorerMenu(orcaPage, row, 'New Console')
      const qualified = `${schema}.${table}`
      await runInConsole(orcaPage, driver.createTable(qualified))
      await expect(orcaPage.getByText(/^CREATE completed/)).toBeVisible({ timeout: 30_000 })
      await runInConsole(orcaPage, `insert into ${qualified} values (1, 'a'), (2, 'b'), (3, 'c');`)
      await expect(orcaPage.getByText(/^INSERT: 3 rows affected/)).toBeVisible({ timeout: 30_000 })

      // Unqualified names complete from the current schema: the URL's database, or dbo.
      const suggestions = consoleSuggestions(orcaPage)
      await typeInConsole(orcaPage, `select * from ${table.slice(0, -3)}`)
      await triggerSuggest(orcaPage)
      await expect(suggestions.filter({ hasText: table })).toHaveCount(1)
      await orcaPage.keyboard.press('Escape')
      await typeInConsole(orcaPage, `select  from ${table} t`)
      await moveCaretInLine(orcaPage, 'select '.length)
      await orcaPage.keyboard.type('t.')
      await expect(suggestions).toHaveCount(2, { timeout: 10_000 })
      await expect(suggestions.nth(1)).toContainText('label')
      await orcaPage.keyboard.press('Escape')

      const setup = driver.twoSetsSetup(routine)
      if (setup) {
        await runAll(orcaPage, setup)
        await expect(orcaPage.getByText(/^CREATE completed/).last()).toBeVisible({
          timeout: 30_000
        })
      }
      await expect(orcaPage.getByText(/already exists/)).toHaveCount(0)
      await runInConsole(orcaPage, driver.callTwoSets(routine))
      const resultTabs = orcaPage.getByRole('tab', { name: /^Result \d+$/ })
      await expect(resultTabs).toHaveCount(2, { timeout: 30_000 })
      const grid = orcaPage.getByRole('grid')
      // The newest result set is shown; the earlier one is a click away.
      await expect(grid.getByRole('columnheader', { name: /^second/ })).toBeVisible()
      await resultTabs.first().click()
      await expect(grid.getByRole('columnheader', { name: /^first/ })).toBeVisible()

      // The toolbar's cancel stops a long statement within seconds.
      const startedAt = Date.now()
      await runInConsole(orcaPage, driver.sleep)
      await orcaPage.waitForTimeout(1_000)
      await orcaPage.getByRole('button', { name: 'Cancel running statement' }).click()
      // MySQL's SLEEP() returns 1 when killed; MariaDB and SQL Server report a cancellation.
      const cancelled = grid
        .getByRole('gridcell', { name: '1', exact: true })
        .or(orcaPage.getByText('Cancelled', { exact: true }))
      await expect(cancelled).toBeVisible({ timeout: 15_000 })
      expect(Date.now() - startedAt).toBeLessThan(20_000)

      await row.dblclick()
      await tree.getByRole('treeitem', { name: schema, exact: true }).dblclick()
      await tree.getByRole('treeitem', { name: table, exact: true }).dblclick()
      await expect(orcaPage.getByText(/^3 rows$/)).toBeVisible({ timeout: 30_000 })
      await orcaPage.getByLabel('WHERE').fill('id > 1')
      await orcaPage.getByLabel('WHERE').press('Enter')
      await expect(orcaPage.getByText(/^2 rows$/)).toBeVisible({ timeout: 30_000 })
      await orcaPage.screenshot({ path: testInfo.outputPath(`${driver.label}-table-data.png`) })

      await addServerConnection(orcaPage, {
        url,
        type: driver.type,
        name: `ro-${driver.label}`,
        readOnly: true
      })
      await explorerMenu(
        orcaPage,
        tree.getByRole('treeitem', { name: new RegExp(`^ro-${driver.label}`) }),
        'New Console'
      )
      await runInConsole(orcaPage, `insert into ${qualified} values (9, 'z');`)
      await expect(orcaPage.getByText(driver.readOnlyRefusal)).toBeVisible({ timeout: 30_000 })

      await orcaPage.getByRole('tab', { name: `rw-${driver.label}` }).click()
      const drop = driver.dropTwoSets(routine)
      await runAll(orcaPage, `${drop}\ndrop table ${qualified};`)
      await expect(orcaPage.getByText(/^DROP completed/).last()).toBeVisible({ timeout: 30_000 })
    })
  })
}
