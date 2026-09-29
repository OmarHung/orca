import { spawnSync } from 'node:child_process'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  startSshVpnTestNetwork,
  VPN_TEST_SSHD_NAME,
  type SshVpnTestNetwork
} from './helpers/docker-ssh-vpn-network'
import { waitForSessionReady } from './helpers/store'

// Why: mirrors SSH_SESSIONS_WORKTREE_ID in src/shared/local-synthetic-workspace.ts.
const SSH_WORKTREE_ID = 'global-ssh-sessions'
const RUN = process.env.ORCA_E2E_SSH_VPN_DOCKER === '1'
const HOST_LABEL = 'e2e-behind-vpn'

async function setUpVpnHost(
  page: Page,
  network: SshVpnTestNetwork
): Promise<{
  targetId: string
  profileId: string
}> {
  return page.evaluate(
    async ({ label, host, identityFile, ovpnPath }) => {
      const { target } = await window.api.ssh.addTarget({
        target: { label, host, port: 22, username: 'root', identityFile, identitiesOnly: true }
      })
      const saved = await window.api.sshVpn.saveProfile({
        draft: { name: 'E2E VPN', ovpnPath, idleMinutes: 10 }
      })
      if (!saved.ok) {
        throw new Error(saved.error.message)
      }
      await window.api.sshVpn.setAssignment({ targetId: target.id, profileId: saved.value.id })
      return { targetId: target.id, profileId: saved.value.id }
    },
    {
      label: HOST_LABEL,
      host: VPN_TEST_SSHD_NAME,
      identityFile: network.privateKeyPath,
      ovpnPath: network.ovpnPath
    }
  )
}

async function acceptConfirm(page: Page, expectedCommand: string): Promise<void> {
  const dialog = page.locator('[data-command-confirm]')
  await expect(dialog.locator('[data-command-list]')).toContainText(expectedCommand)
  await dialog.locator('[data-command-confirm-accept]').click()
  await expect(dialog).toBeHidden()
}

async function readSshTabIds(page: Page): Promise<string[]> {
  return page.evaluate(
    (worktreeId) =>
      (window.__store?.getState().tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id),
    SSH_WORKTREE_ID
  )
}

async function readTerminalText(page: Page, tabId: string): Promise<string> {
  return page.evaluate((id) => {
    const panes = window.__paneManagers?.get(id)?.getPanes?.() ?? []
    return panes[0]?.serializeAddon?.serialize?.() ?? ''
  }, tabId)
}

test.describe('SSH hosts routed through a per-host OpenVPN container', () => {
  test.skip(!RUN, 'Set ORCA_E2E_SSH_VPN_DOCKER=1 to run the Docker-backed VPN E2E.')
  test.skip(process.platform === 'win32', 'The VPN test network uses POSIX tooling.')

  test('SFTP and SSH page sessions reach a host only the VPN can route to', async ({
    orcaPage
  }, testInfo) => {
    test.setTimeout(300_000)
    const network = startSshVpnTestNetwork()
    let profileId: string | null = null
    try {
      expect(network.canReachWithoutVpn()).toBe(false)
      await waitForSessionReady(orcaPage)
      const ids = await setUpVpnHost(orcaPage, network)
      profileId = ids.profileId

      // SFTP connects through main; main asks before starting the VPN, from any page.
      await orcaPage.evaluate((targetId) => {
        // Why not awaited: it blocks on the start confirmation this test answers below.
        Reflect.set(window, '__e2eVpnHome', window.api.sftp.home(targetId))
      }, ids.targetId)
      await acceptConfirm(orcaPage, 'openvpn --config /run/orca/profile.ovpn')
      const home = await orcaPage.evaluate(() => Reflect.get(window, '__e2eVpnHome'))
      expect(home).toEqual({ ok: true, value: '/root' })

      // The host list shows the host's VPN, now connected.
      await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
      const sshPage = orcaPage.locator('[data-ssh-page]')
      const row = sshPage.locator('[data-ssh-host-row]').filter({ hasText: HOST_LABEL })
      await expect(row.locator('[data-ssh-host-vpn]')).toContainText('E2E VPN')
      await expect(row.locator('[data-ssh-vpn-status="ready"]')).toBeVisible()

      // The VPN is already up, so the SSH page asks only about the ssh command it types.
      await row.click()
      await acceptConfirm(orcaPage, 'ProxyCommand=')
      await expect.poll(async () => (await readSshTabIds(orcaPage)).length).toBe(1)
      const [tabId] = await readSshTabIds(orcaPage)
      // Why: any of these means ssh reached the VPN-only sshd; without the VPN it times out.
      await expect
        .poll(() => readTerminalText(orcaPage, tabId), { timeout: 60_000 })
        .toMatch(/authenticity of host|Permission denied|root@/)
      await orcaPage.screenshot({ path: testInfo.outputPath('ssh-page-through-vpn.png') })
    } finally {
      if (profileId) {
        spawnSync(
          'sh',
          [
            '-c',
            `docker ps -aq --filter label=dev.orca.ssh-vpn.profile=${profileId} | xargs docker rm -f`
          ],
          { stdio: 'ignore' }
        )
      }
      network.dispose()
    }
  })
})
