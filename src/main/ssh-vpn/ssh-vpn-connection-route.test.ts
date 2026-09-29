import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clientInstances, resetSshConnectionMocks } from '../ssh/ssh-connection-test-harness'
import { createCallbacks, createTarget } from '../ssh/ssh-connection-test-fixtures'
import { SshConnection } from '../ssh/ssh-connection'
import type * as SshProxyCommandModule from '../ssh/ssh-proxy-command'
import type { EffectiveProxy } from '../ssh/ssh-proxy-command'

const { prepareSshVpnRouteMock, spawnProxyCommandMock } = vi.hoisted(() => ({
  prepareSshVpnRouteMock: vi.fn(),
  spawnProxyCommandMock: vi.fn()
}))

vi.mock('ssh2', async () => (await import('../ssh/ssh-connection-test-harness')).createSsh2Module())
vi.mock('../ssh/system-ssh-binary', async () =>
  (await import('../ssh/ssh-connection-test-harness')).createSystemSshBinaryModule()
)
vi.mock('../ssh/ssh-system-fallback', async () =>
  (await import('../ssh/ssh-connection-test-harness')).createSystemFallbackModule()
)
vi.mock('../ssh/ssh-control-socket', async () =>
  (await import('../ssh/ssh-connection-test-harness')).createControlSocketModule()
)
vi.mock('../ssh/ssh-config-parser', async () =>
  (await import('../ssh/ssh-connection-test-harness')).createSshConfigParserModule()
)
vi.mock('./ssh-vpn-route', () => ({
  prepareSshVpnRoute: prepareSshVpnRouteMock,
  getSshVpnProxyCommand: () => null
}))
vi.mock('../ssh/ssh-proxy-command', async (importOriginal) => ({
  ...(await importOriginal<typeof SshProxyCommandModule>()),
  spawnProxyCommand: spawnProxyCommandMock
}))

const VPN_PROXY: EffectiveProxy = {
  kind: 'argv',
  program: '/usr/local/bin/docker',
  args: ['exec', '-i', 'c', 'nc', '%h', '%p']
}

describe('SshConnection with a per-host VPN', () => {
  beforeEach(() => {
    resetSshConnectionMocks()
    prepareSshVpnRouteMock.mockReset()
    spawnProxyCommandMock.mockReset()
    spawnProxyCommandMock.mockImplementation(() => ({
      process: { kill: vi.fn() },
      sock: new PassThrough()
    }))
  })

  it('connects ssh2 through the VPN proxy it was handed', async () => {
    prepareSshVpnRouteMock.mockResolvedValue(VPN_PROXY)
    const target = createTarget()

    await new SshConnection(target, createCallbacks()).connect()

    expect(prepareSshVpnRouteMock.mock.calls[0][0]).toBe(target)
    expect(spawnProxyCommandMock).toHaveBeenCalledWith(VPN_PROXY, 'example.com', 22, 'deploy')
    expect(clientInstances[0].lastConnectConfig).toHaveProperty(
      'sock',
      spawnProxyCommandMock.mock.results[0].value.sock
    )
  })

  it('does not dial the host when the VPN cannot start', async () => {
    prepareSshVpnRouteMock.mockRejectedValue(new Error('VPN "Office": Docker is not running'))
    const callbacks = createCallbacks()

    await expect(new SshConnection(createTarget(), callbacks).connect()).rejects.toThrow(
      'VPN "Office": Docker is not running'
    )
    expect(clientInstances).toHaveLength(0)
    expect(spawnProxyCommandMock).not.toHaveBeenCalled()
    expect(callbacks.onStateChange).toHaveBeenLastCalledWith(
      'target-1',
      expect.objectContaining({ status: 'error' })
    )
  })

  it('keeps the direct path for hosts without a VPN', async () => {
    prepareSshVpnRouteMock.mockResolvedValue(null)

    await new SshConnection(createTarget(), createCallbacks()).connect()

    expect(spawnProxyCommandMock).not.toHaveBeenCalled()
    expect(clientInstances).toHaveLength(1)
  })
})
