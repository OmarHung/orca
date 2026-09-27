import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  captureDatabaseTransfers,
  dragBetween,
  lastClipboardWrite,
  pickGridSubmenuItem
} from './helpers/database-grid-transfers'
import { addSqliteConnection, openDatabasePage, runInConsole } from './helpers/database-page'
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
