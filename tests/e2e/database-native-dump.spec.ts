import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { findDumpTool } from '../../src/main/database/worker/dump/native/native-dump-tools'
import { adminSql } from './helpers/database-admin'
import { addServerConnection, explorerMenu, openDatabasePage } from './helpers/database-page'
import { test, expect } from './helpers/orca-app'

// Opt-in through ORCA_TEST_POSTGRES_URL / ORCA_TEST_MYSQL_URL, and runs only where pg_dump or
// mysqldump is installed.

const SERVERS = [
  {
    label: 'PostgreSQL',
    driver: 'postgres',
    type: 'PostgreSQL',
    url: process.env.ORCA_TEST_POSTGRES_URL,
    header: /PostgreSQL database dump/
  },
  {
    label: 'MySQL',
    driver: 'mysql',
    type: 'MySQL / MariaDB',
    url: process.env.ORCA_TEST_MYSQL_URL,
    header: /(MySQL|MariaDB) dump/
  }
] as const

for (const server of SERVERS) {
  test(`dumps a ${server.label} schema with its native dump tool`, async ({
    orcaPage,
    electronApp,
    registerPostElectronShutdownCleanup
  }, testInfo) => {
    const tool = server.url
      ? await findDumpTool({ driver: server.driver, serverVersion: '0' })
      : null
    test.skip(!server.url || !tool, `needs a ${server.label} test server and its dump tool`)
    const url = new URL(server.url!)
    const schema = `e2e_native_${randomUUID().slice(0, 8)}`
    const create = server.driver === 'postgres' ? 'create schema' : 'create database'
    await adminSql(url, [
      `${create} ${schema}`,
      `create table ${schema}.items (id int primary key, name varchar(20))`,
      `insert into ${schema}.items values (1, 'first'), (2, 'it''s')`
    ])
    const drop =
      server.driver === 'postgres' ? `drop schema ${schema} cascade` : `drop database ${schema}`
    registerPostElectronShutdownCleanup(() => adminSql(url, [drop], { ignoreErrors: true }))
    const dir = mkdtempSync(join(tmpdir(), 'orca-e2e-native-dump-'))
    registerPostElectronShutdownCleanup(async () => rmSync(dir, { recursive: true, force: true }))

    await openDatabasePage(orcaPage)
    await addServerConnection(orcaPage, { url, type: server.type })
    const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
    await tree
      .getByRole('treeitem', { name: `${url.pathname.slice(1)}@${url.hostname}` })
      .dblclick()
    const schemaRow = tree.getByRole('treeitem', { name: schema })
    await expect(schemaRow).toBeVisible({ timeout: 20_000 })

    await explorerMenu(orcaPage, schemaRow, 'Dump to SQL…')
    const dialog = orcaPage.getByRole('dialog', { name: 'Dump to SQL' })
    await expect(dialog.getByText('Selected: 1 of 1')).toBeVisible({ timeout: 20_000 })
    await dialog.getByLabel('Tool').click()
    await orcaPage.getByRole('option', { name: `${tool!.kind} ${tool!.version}` }).click()
    await expect(dialog.getByText(tool!.path)).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('native-dump-dialog.png') })

    const target = join(dir, `${schema}.sql`)
    await electronApp.evaluate(({ dialog: native }, picked) => {
      native.showSaveDialog = async () => ({ canceled: false, filePath: picked })
    }, target)
    await dialog.getByRole('button', { name: 'Save As…' }).click()
    await expect(orcaPage.getByText('Dump saved')).toBeVisible({ timeout: 30_000 })

    const text = readFileSync(target, 'utf8')
    expect(text).toMatch(server.header)
    expect(text).toMatch(/INSERT INTO .*items/)
    await orcaPage.getByRole('button', { name: 'Jobs' }).click()
    const job = orcaPage
      .getByRole('list', { name: 'Background jobs' })
      .getByRole('listitem')
      .filter({ hasText: 'Dump of' })
    await expect(job).toContainText(`with ${tool!.kind}`)
    // The tool doesn't say how many rows it wrote, so no row count is shown.
    await expect(job).not.toContainText('Rows:')
    await orcaPage.waitForTimeout(300)
    await orcaPage.screenshot({ path: testInfo.outputPath('native-dump-job.png') })
  })
}
