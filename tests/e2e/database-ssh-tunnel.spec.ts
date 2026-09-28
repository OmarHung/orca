import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { findDumpTool } from '../../src/main/database/worker/dump/native/native-dump-tools'
import { adminSql } from './helpers/database-admin'
import {
  addServerConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import {
  cleanupDockerSshRelayTarget,
  execDockerSshRelayTargetControlCommand,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import {
  readSystemSshInvocationKinds,
  trustDockerSshHost
} from './helpers/ssh-port-forward-transport-evidence'
import { test, expect } from './helpers/orca-app'

// Opt-in: a Docker SSH host (ORCA_E2E_SSH_DOCKER=1) plus the database URLs the driver
// tests use. The databases are reached at addresses only the SSH host can see.
const RUN = process.env.ORCA_E2E_SSH_DOCKER === '1'
const MYSQL_URL = process.env.ORCA_TEST_MYSQL_URL
const POSTGRES_URL = process.env.ORCA_TEST_POSTGRES_URL
const BASTION = 'db-bastion'

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim()
}

/** The container publishing `url`'s port, as the SSH container sees it on the bridge network. */
function containerAddress(url: URL): { host: string; port: number; hostname: string } {
  const id = docker('ps', '--filter', `publish=${url.port}`, '--format', '{{.ID}}')
  const mapping = docker('port', id)
    .split('\n')
    .find((line) => line.endsWith(`:${url.port}`))
  return {
    host: docker('inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', id),
    port: Number(mapping?.split('/')[0]),
    hostname: docker('inspect', '-f', '{{.Config.Hostname}}', id)
  }
}

function withEndpoint(raw: string, host: string, port: number): URL {
  const url = new URL(raw)
  url.hostname = host
  url.port = String(port)
  return url
}

async function addBastion(page: Page, target: DockerSshRelayTarget): Promise<string> {
  return page.evaluate(
    async ({ host, port, identityFile, label }) => {
      const { target: created } = await window.api.ssh.addTarget({
        target: { label, host, port, username: 'root', identityFile, identitiesOnly: true }
      })
      const store = window.__store!
      const labels = new Map(store.getState().sshTargetLabels)
      labels.set(created.id, created.label)
      store.getState().setSshTargetLabels(labels)
      return created.id
    },
    { host: target.host, port: target.port, identityFile: target.identityFile, label: BASTION }
  )
}

function connectionRow(page: Page, name: string) {
  return page
    .getByRole('tree', { name: 'Database objects' })
    .getByRole('treeitem', { name: new RegExp(`^${name} via ${BASTION}`) })
}

test.describe('Database SSH tunnels', () => {
  test.skip(
    !RUN || !MYSQL_URL || !POSTGRES_URL,
    'needs ORCA_E2E_SSH_DOCKER=1 and the MySQL/PostgreSQL test URLs'
  )

  /**
   * Dumps `schema` with the server's native tool, which dials the connection's tunnel itself,
   * and returns the file's text; null where the tool isn't installed.
   */
  async function nativeDump(
    page: Page,
    electronApp: ElectronApplication,
    connection: string,
    driver: 'postgres' | 'mysql',
    schema: string
  ): Promise<string | null> {
    const tool = await findDumpTool({ driver, serverVersion: '0' })
    if (!tool) {
      return null
    }
    const connectionItem = connectionRow(page, connection)
    if ((await connectionItem.getAttribute('aria-expanded')) !== 'true') {
      await connectionItem.dblclick()
    }
    const schemaRow = page
      .getByRole('tree', { name: 'Database objects' })
      .getByRole('treeitem', { name: schema, exact: true })
    await expect(schemaRow).toBeVisible({ timeout: 60_000 })
    await explorerMenu(page, schemaRow, 'Dump to SQL…')
    const dialog = page.getByRole('dialog', { name: 'Dump to SQL' })
    await expect(dialog.getByText('Selected: 1 of 1')).toBeVisible({ timeout: 60_000 })
    await dialog.getByLabel('Tool').click()
    await page.getByRole('option', { name: `${tool.kind} ${tool.version}` }).click()
    const dir = mkdtempSync(join(tmpdir(), 'orca-e2e-ssh-dump-'))
    const target = join(dir, `${schema}.sql`)
    try {
      await electronApp.evaluate(({ dialog: native }, picked) => {
        native.showSaveDialog = async () => ({ canceled: false, filePath: picked })
      }, target)
      await dialog.getByRole('button', { name: 'Save As…' }).click()
      await expect(dialog).toBeHidden()
      // The saved toast names this dump's file; an earlier dump's toast may still be up.
      await expect(page.getByText(target, { exact: true })).toBeVisible({ timeout: 60_000 })
      return readFileSync(target, 'utf8')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  test('reaches MySQL and PostgreSQL through a saved SSH host and recovers from an SSH reset', async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    test.setTimeout(300_000)
    const target = startDockerSshRelayTarget(testInfo)
    // Seeded before the explorer lists anything, for the native dumps below.
    // Named apart, so each shows under its own connection only.
    const schema = `e2e_ssh_dump_${Date.now().toString(36)}`
    const mysqlSchema = `${schema}_my`
    const seed = (create: string, name: string) => [
      `${create} ${name}`,
      `create table ${name}.items (id int primary key, name varchar(20))`,
      `insert into ${name}.items values (1, 'through the tunnel')`
    ]
    await adminSql(POSTGRES_URL!, seed('create schema', schema))
    await adminSql(MYSQL_URL!, seed('create database', mysqlSchema))
    try {
      // A tunnel only forwards ports, so it must work on a host where Orca's relay can't run.
      execDockerSshRelayTargetControlCommand(target, 'mv "$(command -v node)" /tmp/node.hidden')
      await trustDockerSshHost(electronApp, target)
      await addBastion(orcaPage, target)
      await openDatabasePage(orcaPage)

      const mysql = containerAddress(new URL(MYSQL_URL!))
      await addServerConnection(orcaPage, {
        url: withEndpoint(MYSQL_URL!, mysql.host, mysql.port),
        type: 'MySQL / MariaDB',
        name: 'mysql-via-ssh',
        sshHost: BASTION
      })
      const mysqlRow = connectionRow(orcaPage, 'mysql-via-ssh')
      await explorerMenu(orcaPage, mysqlRow, 'New Console')
      await runInConsole(orcaPage, 'select @@hostname as served_by;')
      await expect(
        orcaPage.getByRole('grid').getByRole('gridcell', { name: mysql.hostname, exact: true })
      ).toBeVisible({ timeout: 60_000 })
      await expect(mysqlRow.getByRole('img', { name: 'Connected' })).toBeVisible()

      // PostgreSQL on this machine, as the SSH container reaches it.
      await addServerConnection(orcaPage, {
        url: withEndpoint(
          POSTGRES_URL!,
          'host.docker.internal',
          Number(new URL(POSTGRES_URL!).port)
        ),
        name: 'pg-via-ssh',
        sshHost: BASTION
      })
      const pgRow = connectionRow(orcaPage, 'pg-via-ssh')
      await pgRow.dblclick()
      await expect(
        orcaPage.getByRole('tree', { name: 'Database objects' }).getByRole('treeitem', {
          name: 'public',
          exact: true
        })
      ).toBeVisible({ timeout: 60_000 })
      await orcaPage.screenshot({ path: testInfo.outputPath('database-ssh-tunnel.png') })

      // pg_dump and mysqldump dial the same tunnel the connection's own sessions use.
      const pgDump = await nativeDump(orcaPage, electronApp, 'pg-via-ssh', 'postgres', schema)
      if (pgDump !== null) {
        expect(pgDump).toMatch(/INSERT INTO [^;]*items[^;]*through the tunnel/)
      }
      const mysqlDump = await nativeDump(
        orcaPage,
        electronApp,
        'mysql-via-ssh',
        'mysql',
        mysqlSchema
      )
      if (mysqlDump !== null) {
        expect(mysqlDump).toMatch(/INSERT INTO `items`[^;]*through the tunnel/)
      }

      // Resetting the SSH link takes the tunnel down; connecting again rebuilds both.
      // The SSH host drops our session, as a network change or sshd restart would.
      execDockerSshRelayTargetControlCommand(target, "pkill -f '^sshd: root' || true")
      await expect(mysqlRow).toContainText(/SSH connection to db-bastion was reset/, {
        timeout: 30_000
      })
      await expect(mysqlRow.getByRole('img', { name: 'Connection failed' })).toBeVisible()
      await explorerMenu(orcaPage, mysqlRow, 'Connect')
      await expect(mysqlRow.getByRole('img', { name: 'Connected' })).toBeVisible({
        timeout: 60_000
      })

      // A port the SSH host can't reach fails with the SSH host's own reason.
      await orcaPage.getByRole('button', { name: 'New Connection' }).first().click()
      const dialog = orcaPage.getByRole('dialog', { name: 'New Connection' })
      await dialog.getByLabel('Type').click()
      await orcaPage.getByRole('option', { name: 'MySQL / MariaDB' }).click()
      await dialog.getByLabel('SSH tunnel').click()
      await orcaPage.getByRole('option', { name: BASTION, exact: true }).click()
      await dialog.getByLabel('Host').fill(mysql.host)
      await dialog.getByLabel('Port').fill('3399')
      await dialog.getByRole('button', { name: 'Test Connection' }).click()
      await expect(
        dialog.getByText(new RegExp(`SSH tunnel: the SSH host could not reach ${mysql.host}:3399`))
      ).toBeVisible({ timeout: 60_000 })
    } finally {
      cleanupDockerSshRelayTarget(target)
      await adminSql(POSTGRES_URL!, [`drop schema if exists ${schema} cascade`], {
        ignoreErrors: true
      })
      await adminSql(MYSQL_URL!, [`drop database if exists ${mysqlSchema}`], {
        ignoreErrors: true
      })
    }
  })
})

test.describe('Database SSH tunnels over system OpenSSH', () => {
  test.skip(!RUN || !MYSQL_URL, 'needs ORCA_E2E_SSH_DOCKER=1 and ORCA_TEST_MYSQL_URL')
  test.use({ launchEnv: { ORCA_SSH_FORCE_SYSTEM_TRANSPORT: '1' } })

  test('forwards through an ssh -L process and reports it when that process stops', async ({
    orcaPage,
    electronApp
  }, testInfo) => {
    test.setTimeout(300_000)
    const target = startDockerSshRelayTarget(testInfo)
    try {
      const invocations = await trustDockerSshHost(electronApp, target)
      await addBastion(orcaPage, target)
      await openDatabasePage(orcaPage)
      const mysql = containerAddress(new URL(MYSQL_URL!))
      await addServerConnection(orcaPage, {
        url: withEndpoint(MYSQL_URL!, mysql.host, mysql.port),
        type: 'MySQL / MariaDB',
        name: 'mysql-via-openssh',
        sshHost: BASTION
      })
      const row = connectionRow(orcaPage, 'mysql-via-openssh')
      await row.dblclick()
      await expect(row.getByRole('img', { name: 'Connected' })).toBeVisible({ timeout: 60_000 })
      expect(readSystemSshInvocationKinds(invocations)).toContain('forward')

      // Only this test's forward names the container address.
      execFileSync('pkill', ['-f', `127\\.0\\.0\\.1:[0-9]+:${mysql.host}:${mysql.port}`])
      await expect(row).toContainText(/SSH tunnel through db-bastion stopped/, { timeout: 30_000 })
    } finally {
      cleanupDockerSshRelayTarget(target)
    }
  })
})
