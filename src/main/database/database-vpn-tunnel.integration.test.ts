import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SshVpnProfileState } from '../../shared/ssh-vpn-types'
import type { SshVpnDatabaseRoutes } from '../ssh-vpn/ssh-vpn-database-route'
import { resolveDockerPath } from '../docker/docker-cli-location'
import { SshVpnDocker } from '../ssh-vpn/ssh-vpn-docker'
import { SshVpnManager } from '../ssh-vpn/ssh-vpn-manager'
import { SshVpnService } from '../ssh-vpn/ssh-vpn-service'
import { SshVpnStore } from '../ssh-vpn/ssh-vpn-store'
import {
  startSshVpnTestNetwork,
  VPN_TEST_SSHD_NAME,
  type SshVpnTestNetwork
} from '../ssh-vpn/ssh-vpn-test-network'
import { createDatabaseVpnTunnelOpener, DOCKER_VPN_PIPES } from './database-vpn-tunnel'

// Real Docker and OpenVPN. The server behind the VPN is the test network's sshd: reading its
// greeting proves bytes cross the tunnel. Opt in with ORCA_TEST_SSH_VPN_DOCKER=1.
const ENABLED = process.env.ORCA_TEST_SSH_VPN_DOCKER === '1'

function greeting(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('data', (data) => {
      socket.end()
      resolve(String(data))
    })
    socket.once('error', reject)
  })
}

describe.skipIf(!ENABLED)('database connections through a VPN profile (Docker)', () => {
  let network: SshVpnTestNetwork
  let manager: SshVpnManager
  let docker: SshVpnDocker
  let routes: SshVpnDatabaseRoutes
  let profileId: string
  const watchers = new Set<(state: SshVpnProfileState) => void>()
  const request = (remotePort: number) => ({
    profileId,
    connectionLabel: 'shop',
    remoteHost: VPN_TEST_SSHD_NAME,
    remotePort
  })
  const open = createDatabaseVpnTunnelOpener({ routes: () => routes, ...DOCKER_VPN_PIPES })
  const tunnelCount = async (): Promise<number> => {
    const route = manager.getReadyRoute(profileId)
    return route ? docker.countTunnels(route.containerName) : 0
  }

  beforeAll(async () => {
    network = await startSshVpnTestNetwork()
    const dockerPath = await resolveDockerPath()
    if (!dockerPath) {
      throw new Error('docker not found')
    }
    docker = new SshVpnDocker(dockerPath)
    const store = new SshVpnStore(path.join(network.profileDir, 'ssh-vpn.json'))
    profileId = store.saveProfile(undefined, {
      name: 'Test VPN',
      ovpnPath: network.ovpnPath,
      idleMinutes: 10
    }).id
    manager = new SshVpnManager({
      docker: async () => docker,
      instanceTag: `it${randomBytes(3).toString('hex')}`,
      readFile: (filePath) => readFile(filePath),
      onStateChange: (state) => watchers.forEach((watcher) => watcher(state))
    })
    const service = new SshVpnService({ store, manager })
    routes = {
      prepare: async (id, label) => ({ profileName: await service.connect(id, label) }),
      readyRoute: (id) => manager.getReadyRoute(id),
      watch: (id, listener) => {
        const watcher = (state: SshVpnProfileState): void => {
          if (state.profileId === id) {
            listener(state.status)
          }
        }
        watchers.add(watcher)
        return () => watchers.delete(watcher)
      }
    }
  }, 600_000)

  afterAll(async () => {
    await manager?.stopAll()
    await network?.dispose()
  }, 120_000)

  it('cannot reach the server without the VPN', async () => {
    await expect(network.canReachWithoutVpn()).resolves.toBe(false)
  }, 60_000)

  it('reaches a VPN-only server by its VPN DNS name, and leaves no nc behind', async () => {
    const tunnel = await open(request(22), () => undefined)
    expect(await greeting(tunnel.localPort)).toMatch(/^SSH-2\.0-/)
    expect(await greeting(tunnel.localPort)).toMatch(/^SSH-2\.0-/)

    const held = connect(tunnel.localPort, '127.0.0.1')
    await new Promise((resolve) => held.once('data', resolve))
    expect(await tunnelCount()).toBeGreaterThanOrEqual(1)

    await tunnel.close()
    // Why wait: each nc exits once the server closes or its 30s final-read window ends.
    await vi.waitFor(async () => expect(await tunnelCount()).toBe(0), {
      timeout: 45_000,
      interval: 1_000
    })
  }, 240_000)

  it('says the server is unreachable through the VPN instead of opening a dead port', async () => {
    await expect(open(request(1), () => undefined)).rejects.toThrow(
      `VPN "Test VPN" could not reach ${VPN_TEST_SSHD_NAME}:1`
    )
  }, 120_000)

  it('ends the session when the VPN stops', async () => {
    const onLost = vi.fn()
    const tunnel = await open(request(22), onLost)

    await manager.stop(profileId)
    expect(onLost).toHaveBeenCalledWith('VPN "Test VPN" disconnected, so this connection ended.')
    await expect(greeting(tunnel.localPort)).rejects.toThrow()
  }, 120_000)
})
