import { runProcess } from '../../src/shared/child-process/run-process'
import {
  startSshVpnTestNetwork,
  type SshVpnTestNetwork
} from '../../src/main/ssh-vpn/ssh-vpn-test-network'
import {
  addServerConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { expect, test } from './helpers/orca-app'

// Real Docker: MariaDB on a network only the OpenVPN test server reaches.
// Opt in with ORCA_E2E_SSH_VPN_DOCKER=1 (needs the mariadb:10.5 image).
const RUN = process.env.ORCA_E2E_SSH_VPN_DOCKER === '1'
const VPN_NAME = 'E2E VPN'

async function waitUntilHealthy(containerName: string): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const status = await runProcess({
      program: 'docker',
      args: ['inspect', '--format', '{{.State.Health.Status}}', containerName]
    })
    if (status.stdout.trim() === 'healthy') {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`${containerName} did not become healthy`)
}

test.describe('Database connections through a VPN (Docker)', () => {
  test.skip(!RUN, 'set ORCA_E2E_SSH_VPN_DOCKER=1 to run against real Docker + OpenVPN')
  test.describe.configure({ timeout: 300_000 })

  let network: SshVpnTestNetwork
  let databaseIp: string

  test.beforeAll(async () => {
    network = await startSshVpnTestNetwork()
    const database = await network.startBehindVpn([
      '--env',
      'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1',
      // Why TCP: the image's first-run setup serves a socket-only server that would pass a plain ping.
      '--health-cmd',
      'mysqladmin --protocol=tcp -h127.0.0.1 ping --silent',
      '--health-interval',
      '1s',
      'mariadb:10.5'
    ])
    databaseIp = database.address
    await waitUntilHealthy(database.containerName)
  })

  test.afterAll(async () => {
    await network?.dispose()
  })

  test('connects and queries a server only the VPN reaches', async ({ orcaPage }, testInfo) => {
    await openDatabasePage(orcaPage)
    await orcaPage.evaluate(
      async ({ name, ovpnPath }) => {
        const saved = await window.api.sshVpn.saveProfile({
          draft: { name, ovpnPath, idleMinutes: 10 }
        })
        if (!saved.ok) {
          throw new Error(saved.error.message)
        }
      },
      { name: VPN_NAME, ovpnPath: network.ovpnPath }
    )

    await addServerConnection(orcaPage, {
      url: new URL(`mysql://root@${databaseIp}:3306/`),
      type: 'MySQL / MariaDB',
      name: 'behind-vpn',
      vpn: VPN_NAME
    })
    const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
    const connection = tree.getByRole('treeitem', { name: /^behind-vpn/ })
    await expect(connection).toContainText(`via VPN ${VPN_NAME}`)

    await explorerMenu(orcaPage, connection, 'New Console')
    await runInConsole(orcaPage, 'select @@version as version;')
    await expect(orcaPage.getByRole('grid').getByRole('gridcell', { name: /MariaDB/ })).toBeVisible(
      { timeout: 60_000 }
    )
    await expect(connection.getByRole('img', { name: 'Connected' })).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('database-through-vpn.png') })

    await orcaPage.getByRole('button', { name: 'New Connection' }).first().click()
    const dialog = orcaPage.getByRole('dialog')
    await dialog.getByLabel('VPN', { exact: true }).click()
    await orcaPage.getByRole('option', { name: VPN_NAME, exact: true }).click()
    await expect(dialog.getByText(/^Host and port are as seen from inside the VPN\./)).toBeVisible()
    await orcaPage.screenshot({ path: testInfo.outputPath('connection-dialog-vpn.png') })
  })
})
