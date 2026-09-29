import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { Client, type ConnectConfig } from 'ssh2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
import { runProcess } from '../../shared/child-process/run-process'
import { spawnProxyCommand } from '../ssh/ssh-proxy-command'
import { resolveDockerPath, SshVpnDocker } from './ssh-vpn-docker'
import { SshVpnManager } from './ssh-vpn-manager'
import { SshVpnService } from './ssh-vpn-service'
import { SshVpnStore } from './ssh-vpn-store'
import {
  startSshVpnTestNetwork,
  TEST_SSHD_NAME,
  type SshVpnTestNetwork
} from './ssh-vpn-test-network'

// Real Docker, real OpenVPN, real sshd. Opt in with ORCA_TEST_SSH_VPN_DOCKER=1.
const ENABLED = process.env.ORCA_TEST_SSH_VPN_DOCKER === '1'

const TARGET: SshTarget = {
  id: 'target-behind-vpn',
  label: 'behind-vpn',
  host: TEST_SSHD_NAME,
  port: 22,
  username: 'root'
}

function interfaceNames(): string[] {
  return Object.keys(networkInterfaces()).sort()
}

function connectSsh2(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.once('ready', () => resolve(client))
    client.once('error', reject)
    client.connect(config)
  })
}

function exec(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, channel) => {
      if (error) {
        reject(error)
        return
      }
      let output = ''
      channel.on('data', (chunk: Buffer) => (output += chunk.toString()))
      channel.on('close', () => resolve(output.trim()))
    })
  })
}

function readdir(client: Client, dir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error)
        return
      }
      sftp.readdir(dir, (readError, entries) => {
        sftp.end()
        if (readError) {
          reject(readError)
          return
        }
        resolve(entries.map((entry) => entry.filename))
      })
    })
  })
}

describe.skipIf(!ENABLED)('SSH through a per-host OpenVPN container (Docker)', () => {
  let network: SshVpnTestNetwork
  let manager: SshVpnManager
  let service: SshVpnService
  let docker: SshVpnDocker
  let interfacesBefore: string[]
  const instanceTag = `it${randomBytes(3).toString('hex')}`

  beforeAll(async () => {
    interfacesBefore = interfaceNames()
    network = await startSshVpnTestNetwork()
    const dockerPath = await resolveDockerPath()
    if (!dockerPath) {
      throw new Error('docker not found')
    }
    docker = new SshVpnDocker(dockerPath)
    const store = new SshVpnStore(path.join(network.profileDir, 'ssh-vpn.json'))
    const profile = store.saveProfile(undefined, {
      name: 'Test VPN',
      ovpnPath: network.ovpnPath,
      idleMinutes: 10
    })
    store.setAssignment(TARGET.id, profile.id)
    manager = new SshVpnManager({
      docker: async () => docker,
      instanceTag,
      readFile: (filePath) => readFile(filePath)
    })
    service = new SshVpnService({ store, manager })
  }, 600_000)

  afterAll(async () => {
    await manager?.stopAll()
    await network?.dispose()
  }, 120_000)

  it('cannot reach the host without the VPN', async () => {
    await expect(network.canReachWithoutVpn()).resolves.toBe(false)
  }, 60_000)

  it('runs commands and SFTP over ssh2 through the tunnel, resolving the VPN-only DNS name', async () => {
    const proxy = await service.prepare(TARGET, null)
    if (!proxy) {
      throw new Error('expected a VPN proxy for the assigned host')
    }
    const { process: proxyProcess, sock } = spawnProxyCommand(
      proxy,
      TARGET.host,
      TARGET.port,
      'root'
    )
    const client = await connectSsh2({
      sock,
      username: 'root',
      privateKey: network.privateKey,
      readyTimeout: 20_000
    })
    try {
      await expect(exec(client, 'echo vpn-ok')).resolves.toBe('vpn-ok')
      await expect(readdir(client, '/etc')).resolves.toContain('ssh')
      expect(
        await docker.countTunnels(
          `orca-ssh-vpn-${instanceTag}-${manager.listStates()[0].profileId}`
        )
      ).toBe(1)
    } finally {
      client.end()
      proxyProcess.kill()
    }
  }, 300_000)

  it('gives system ssh a ProxyCommand that works (the SSH page and FIDO2/GSSAPI path)', async () => {
    await service.prepare(TARGET, null)
    const proxyCommand = service.proxyCommand(TARGET)
    const result = await runProcess({
      program: 'ssh',
      args: [
        '-F',
        '/dev/null',
        '-o',
        `ProxyCommand=${proxyCommand}`,
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        'UserKnownHostsFile=/dev/null',
        '-o',
        'BatchMode=yes',
        '-o',
        'IdentitiesOnly=yes',
        '-i',
        network.privateKeyPath,
        `root@${TEST_SSHD_NAME}`,
        'echo system-ok'
      ],
      timeoutMs: 60_000
    })
    expect(result.stdout.trim()).toBe('system-ok')
  }, 120_000)

  it('leaves the host network untouched', () => {
    expect(interfaceNames()).toEqual(interfacesBefore)
  })

  it('stops by removing the container, after which system ssh refuses to connect', async () => {
    const [state] = manager.listStates()
    await manager.stop(state.profileId)

    const remaining = await runProcess({
      program: 'docker',
      args: [
        'ps',
        '--all',
        '--filter',
        `name=orca-ssh-vpn-${instanceTag}`,
        '--format',
        '{{.Names}}'
      ]
    })
    expect(remaining.stdout.trim()).toBe('')
    expect(() => service.proxyCommand(TARGET)).toThrow('is not connected')
  }, 60_000)
})
