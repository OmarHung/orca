import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult } from '../../shared/child-process/process-spec'
import {
  checkBorrowedContainer,
  listBorrowableContainers,
  type BorrowedContainerDocker
} from './borrowed-container-check'

const SECTION = '@@orca-section@@'
const IPV4 = [
  '-P OUTPUT ACCEPT',
  '-A OUTPUT -o tun+ -m owner --uid-owner 100 -j ACCEPT',
  '-A OUTPUT -m owner --uid-owner 100 -j REJECT --reject-with icmp-port-unreachable'
].join('\n')
const IPV6 = IPV4.replace('icmp-port', 'icmp6-port')

function result(code: number, stdout = '', stderr = ''): ProcessResult {
  return { code, signal: null, stdout, stderr, timedOut: false }
}

function state(fields: Record<string, unknown>): ProcessResult {
  return result(0, JSON.stringify({ Running: true, Status: 'running', ...fields }))
}

function fakeDocker(inspect: ProcessResult, firewall: ProcessResult): BorrowedContainerDocker {
  return {
    dockerPath: '/usr/local/bin/docker',
    query: vi.fn(async (args: readonly string[]) => (args[0] === 'container' ? inspect : firewall))
  }
}

const SAFE_FIREWALL = result(0, `100\n${SECTION}\n${IPV4}\n${SECTION}\n${IPV6}\n`)

describe('checkBorrowedContainer', () => {
  it('passes a healthy container whose firewall keeps the tunnel user on the VPN', async () => {
    const docker = fakeDocker(state({ Health: { Status: 'healthy' } }), SAFE_FIREWALL)

    await checkBorrowedContainer(docker, 'vpn-office-1', { requireHealthy: true })

    expect(docker.query).toHaveBeenCalledWith([
      'container',
      'inspect',
      '--format',
      '{{json .State}}',
      'vpn-office-1'
    ])
    expect(docker.query).toHaveBeenCalledWith(
      expect.arrayContaining(['exec', '--user', '0', 'vpn-office-1', 'sh', '-c'])
    )
  })

  it('says to start a container Docker does not have, or one that stopped', async () => {
    await expect(
      checkBorrowedContainer(
        fakeDocker(result(1, '', 'Error: No such container: vpn-x'), SAFE_FIREWALL),
        'vpn-x',
        { requireHealthy: true }
      )
    ).rejects.toThrow('Docker has no container named "vpn-x"')
    await expect(
      checkBorrowedContainer(
        fakeDocker(state({ Running: false, Status: 'exited' }), SAFE_FIREWALL),
        'vpn-x',
        { requireHealthy: false }
      )
    ).rejects.toThrow('Container "vpn-x" is exited')
  })

  it('waits for a failing healthcheck only when connecting', async () => {
    const docker = fakeDocker(state({ Health: { Status: 'starting' } }), SAFE_FIREWALL)

    await expect(checkBorrowedContainer(docker, 'vpn-x', { requireHealthy: true })).rejects.toThrow(
      'has not connected its VPN yet (health: starting)'
    )
    await expect(
      checkBorrowedContainer(docker, 'vpn-x', { requireHealthy: false })
    ).resolves.toBeUndefined()
  })

  it('refuses a container without the tunnel user', async () => {
    const docker = fakeDocker(state({}), result(3, '', "id: 'tunnel': no such user"))

    await expect(checkBorrowedContainer(docker, 'vpn-x', { requireHealthy: true })).rejects.toThrow(
      'has no "tunnel" user'
    )
  })

  it('refuses a firewall that lets the tunnel user out directly, on either IP version', async () => {
    const open = result(0, `100\n${SECTION}\n${IPV4}\n${SECTION}\n-P OUTPUT ACCEPT\n`)

    await expect(
      checkBorrowedContainer(fakeDocker(state({}), open), 'vpn-x', { requireHealthy: true })
    ).rejects.toThrow('does not keep the "tunnel" user on the VPN')
  })

  it('reports a firewall it cannot read', async () => {
    const docker = fakeDocker(state({}), result(127, '', 'sh: iptables: not found'))

    await expect(checkBorrowedContainer(docker, 'vpn-x', { requireHealthy: true })).rejects.toThrow(
      'Could not read the firewall of container "vpn-x": sh: iptables: not found'
    )
  })
})

describe('listBorrowableContainers', () => {
  it("lists running containers except Orca's own VPN containers", async () => {
    const docker: BorrowedContainerDocker = {
      dockerPath: 'docker',
      query: vi.fn(async () =>
        result(
          0,
          [
            'vpn-office-1\topenvpn-socks:local\tUp 2 hours (healthy)\t',
            'orca-ssh-vpn-abc-123\torca-ssh-vpn:1\tUp 1 minute\t1',
            ''
          ].join('\n')
        )
      )
    }

    await expect(listBorrowableContainers(docker)).resolves.toEqual([
      { name: 'vpn-office-1', image: 'openvpn-socks:local', status: 'Up 2 hours (healthy)' }
    ])
  })
})
