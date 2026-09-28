import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  captureDatabaseTransfers,
  dragBetween,
  lastClipboardWrite,
  pickGridSubmenuItem
} from './helpers/database-grid-transfers'
import {
  addServerConnection,
  addSqliteConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { expandPeople, seedShopDatabase } from './helpers/database-sqlite-shop'
import { test, expect } from './helpers/orca-app'

const ADA_PROFILE = '{"lang":"en","tags":["math"]}'

// Clipboard writes and save dialogs are captured in the main process, so the real
// clipboard is never touched and no native dialog opens.
test('copies grid selections in every format and exports loaded rows to files', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  const exportDir = mkdtempSync(join(tmpdir(), 'orca-e2e-export-'))
  registerPostElectronShutdownCleanup(async () =>
    rmSync(exportDir, { recursive: true, force: true })
  )
  await captureDatabaseTransfers(electronApp, exportDir, sep)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  await (await expandPeople(orcaPage)).dblclick()

  const grid = orcaPage.getByRole('grid')
  const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true })
  const lastCopy = () => lastClipboardWrite(electronApp)
  await expect(cell('Ada')).toBeVisible({ timeout: 20_000 })

  // Click then Shift+click selects a rectangle; Mod+C copies it as TSV without headers.
  await cell('1').click()
  await cell('Bob').click({ modifiers: ['Shift'] })
  await orcaPage.keyboard.press('ControlOrMeta+C')
  await expect.poll(lastCopy).toBe('1\tAda\n2\tBob')

  // A mouse drag selects down the column; right-clicking inside keeps that selection.
  await dragBetween(orcaPage, cell('Ada'), cell('Cy'))
  await cell('Bob').click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Copy with Headers' }).click()
  await expect.poll(lastCopy).toBe('name\nAda\nBob\nCy')

  await pickGridSubmenuItem(orcaPage, cell('Bob'), 'Copy As', 'JSON')
  await expect
    .poll(async () => JSON.parse((await lastCopy()) ?? 'null'))
    .toEqual([{ name: 'Ada' }, { name: 'Bob' }, { name: 'Cy' }])
  await pickGridSubmenuItem(orcaPage, cell('Bob'), 'Copy As', 'SQL INSERT')
  await expect
    .poll(lastCopy)
    .toBe(
      [
        "INSERT INTO people (name) VALUES ('Ada');",
        "INSERT INTO people (name) VALUES ('Bob');",
        "INSERT INTO people (name) VALUES ('Cy');"
      ].join('\n')
    )

  // A row-number click selects the whole row; NULL becomes an empty CSV field.
  await grid.getByRole('rowheader', { name: '2', exact: true }).click()
  await pickGridSubmenuItem(orcaPage, cell('Bob'), 'Copy As', 'CSV')
  await expect.poll(lastCopy).toBe('id,name,profile\n2,Bob,')

  // Mod+A then Mod+C copies everything; the JSON value is quoted for TSV.
  await cell('Cy').click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  await orcaPage.keyboard.press('ControlOrMeta+C')
  await expect
    .poll(lastCopy)
    .toBe(`1\tAda\t"${ADA_PROFILE.replaceAll('"', '""')}"\n2\tBob\t\n3\tCy\t`)

  // Export writes every loaded row, whatever is selected, under the table's name.
  await pickGridSubmenuItem(orcaPage, cell('Bob'), 'Export Loaded Rows', 'CSV…')
  await expect(orcaPage.getByText('Exported 3 rows').first()).toBeVisible({ timeout: 20_000 })
  expect(readFileSync(join(exportDir, 'people.csv'), 'utf8')).toBe(
    `id,name,profile\n1,Ada,"${ADA_PROFILE.replaceAll('"', '""')}"\n2,Bob,\n3,Cy,`
  )
  await pickGridSubmenuItem(orcaPage, cell('Bob'), 'Export Loaded Rows', 'JSON…')
  await expect.poll(() => existsSync(join(exportDir, 'people.json'))).toBe(true)
  expect(JSON.parse(readFileSync(join(exportDir, 'people.json'), 'utf8'))).toEqual([
    { id: '1', name: 'Ada', profile: ADA_PROFILE },
    { id: '2', name: 'Bob', profile: null },
    { id: '3', name: 'Cy', profile: null }
  ])
  await pickGridSubmenuItem(orcaPage, cell('Bob'), 'Export Loaded Rows', 'SQL INSERT…')
  await expect.poll(() => existsSync(join(exportDir, 'people.sql'))).toBe(true)
  expect(readFileSync(join(exportDir, 'people.sql'), 'utf8')).toBe(
    [
      `INSERT INTO people (id, name, profile) VALUES (1, 'Ada', '${ADA_PROFILE}');`,
      "INSERT INTO people (id, name, profile) VALUES (2, 'Bob', NULL);",
      "INSERT INTO people (id, name, profile) VALUES (3, 'Cy', NULL);"
    ].join('\n')
  )
  await orcaPage.screenshot({ path: testInfo.outputPath('database-grid-transfers.png') })

  // Query results copy in the order shown after a local sort, not the server's order.
  await orcaPage.getByRole('treeitem', { name: 'shop.db' }).click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'New Console' }).click()
  await runInConsole(orcaPage, 'select name from people order by id;')
  const nameHeader = grid.getByRole('button', { name: /^name/ })
  await expect(nameHeader).toBeVisible({ timeout: 20_000 })
  await nameHeader.click()
  await nameHeader.click()
  await cell('Ada').click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  await orcaPage.keyboard.press('ControlOrMeta+C')
  await expect.poll(lastCopy).toBe('Cy\nBob\nAda')
})

// Rows 1 and 515 carry a 15,000-character text; row 515 also 6,000 bytes, past the preview too.
const LONG_ROWS_SQL =
  "with recursive s(n) as (select 1 union all select n + 1 from s where n < 520) select n, case when n in (1, 515) then replace(hex(zeroblob(7500)), '0', 'x') || n else 'v' || n end as body, case when n = 515 then zeroblob(6000) end as bin from s;"
const longText = (n: number): string => `${'x'.repeat(15_000)}${n}`
const LONG_BINARY = `0x${'0'.repeat(12_000)}`

test('copies and exports values past the preview whole, from a later page and a selection', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const filePath = seedShopDatabase(registerPostElectronShutdownCleanup)
  const exportDir = mkdtempSync(join(tmpdir(), 'orca-e2e-export-'))
  registerPostElectronShutdownCleanup(async () =>
    rmSync(exportDir, { recursive: true, force: true })
  )
  await captureDatabaseTransfers(electronApp, exportDir, sep)
  await openDatabasePage(orcaPage)
  await addSqliteConnection(orcaPage, filePath)
  await orcaPage.getByRole('button', { name: 'Open Console for shop.db' }).click()
  await runInConsole(orcaPage, LONG_ROWS_SQL)

  const grid = orcaPage.getByRole('grid')
  const cell = (name: string) => grid.getByRole('gridcell', { name, exact: true })
  const lastCopy = () => lastClipboardWrite(electronApp)
  await expect(cell('v2')).toBeVisible({ timeout: 20_000 })
  // The first page holds 500 rows; scrolling to the end loads the second.
  await expect
    .poll(
      async () => {
        await grid.evaluate((element) => element.scrollTo(0, element.scrollHeight))
        return grid.getByRole('rowheader', { name: '520', exact: true }).isVisible()
      },
      { timeout: 20_000 }
    )
    .toBe(true)

  // Row 515 arrived with the second page; its row header selects all of its cells.
  await grid.getByRole('rowheader', { name: '515', exact: true }).click()
  await pickGridSubmenuItem(orcaPage, cell('515'), 'Copy As', 'JSON')
  await expect
    .poll(async () => JSON.parse((await lastCopy()) ?? 'null'), { timeout: 20_000 })
    .toEqual([{ n: '515', body: longText(515), bin: LONG_BINARY }])

  await pickGridSubmenuItem(orcaPage, cell('515'), 'Export Loaded Rows', 'CSV…')
  await expect(orcaPage.getByText('Exported 520 rows').first()).toBeVisible({ timeout: 20_000 })
  const lines = readFileSync(join(exportDir, 'result.csv'), 'utf8').split('\n')
  expect(lines).toHaveLength(521)
  expect(lines[1]).toBe(`1,${longText(1)},`)
  expect(lines[515]).toBe(`515,${longText(515)},${LONG_BINARY}`)
  await orcaPage.screenshot({ path: testInfo.outputPath('database-long-values-exported.png') })

  // Cancelling in another console restarts SQLite's worker, which held the whole values:
  // the export is refused, and says so, rather than written from the previews.
  await orcaPage.getByRole('treeitem', { name: 'shop.db' }).click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'New Console' }).click()
  await expect(orcaPage.getByRole('tab', { name: 'shop.db (2)' })).toBeVisible()
  await runInConsole(
    orcaPage,
    'with recursive s(n) as (select 1 union all select n + 1 from s where n < 1000000000) select count(*) from s;'
  )
  await orcaPage.waitForTimeout(500)
  await orcaPage.getByRole('button', { name: 'Cancel running statement' }).click()
  await expect(orcaPage.getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 20_000 })
  await orcaPage.getByRole('tab', { name: 'shop.db Close tab', exact: true }).click()
  rmSync(join(exportDir, 'result.csv'))
  await pickGridSubmenuItem(orcaPage, cell('v2'), 'Export Loaded Rows', 'CSV…')
  await expect(
    orcaPage.getByText(/no longer holds the whole text of 3 values longer than 10,000/)
  ).toBeVisible({ timeout: 20_000 })
  expect(existsSync(join(exportDir, 'result.csv'))).toBe(false)
  await orcaPage.screenshot({ path: testInfo.outputPath('database-long-values-refused.png') })
})

const sqlServerUrl = process.env.ORCA_TEST_SQLSERVER_URL

test('copies and exports SQL Server decimals digit for digit', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}) => {
  test.skip(!sqlServerUrl, 'set ORCA_TEST_SQLSERVER_URL to a disposable server')
  const exportDir = mkdtempSync(join(tmpdir(), 'orca-e2e-export-'))
  registerPostElectronShutdownCleanup(async () =>
    rmSync(exportDir, { recursive: true, force: true })
  )
  await captureDatabaseTransfers(electronApp, exportDir, sep)
  await openDatabasePage(orcaPage)
  await addServerConnection(orcaPage, {
    url: new URL(sqlServerUrl!),
    type: 'SQL Server',
    name: 'db-decimals'
  })
  const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
  await explorerMenu(orcaPage, tree.getByRole('treeitem', { name: /^db-decimals/ }), 'New Console')
  await runInConsole(
    orcaPage,
    "select cast('12345678901234567890.123456789012345678' as decimal(38,18)) as d, cast('99999999999999999999999999999999999999' as numeric(38,0)) as n, cast(922337203685477.5807 as money) as m"
  )
  const grid = orcaPage.getByRole('grid')
  const decimal = grid.getByRole('gridcell', {
    name: '12345678901234567890.123456789012345678',
    exact: true
  })
  await expect(decimal).toBeVisible({ timeout: 30_000 })
  await decimal.click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  await orcaPage.keyboard.press('ControlOrMeta+C')
  await expect
    .poll(() => lastClipboardWrite(electronApp))
    .toBe(
      '12345678901234567890.123456789012345678\t99999999999999999999999999999999999999\t922337203685477.5807'
    )
  await pickGridSubmenuItem(orcaPage, decimal, 'Export Loaded Rows', 'SQL INSERT…')
  await expect.poll(() => existsSync(join(exportDir, 'result.sql'))).toBe(true)
  expect(readFileSync(join(exportDir, 'result.sql'), 'utf8')).toBe(
    'INSERT INTO my_table (d, n, m) VALUES (12345678901234567890.123456789012345678, 99999999999999999999999999999999999999, 922337203685477.5807);'
  )
})
