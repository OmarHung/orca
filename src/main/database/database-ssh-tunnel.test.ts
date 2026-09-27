import { describe, expect, it } from 'vitest'
import type { SshConnection } from '../ssh/ssh-connection'
import { SshPortForwardManager } from '../ssh/ssh-port-forward'
import type {
  PortForwardStartOptions,
  SshPortForwardProvider
} from '../ssh/ssh-port-forward-provider'
import { createDatabaseTunnelOpener, type DatabaseTunnelDeps } from './database-ssh-tunnel'

type ForwardOut = (
  srcHost: string,
  srcPort: number,
  host: string,
  port: number,
  callback: (error: Error | undefined, channel: { close: () => void }) => void
) => void

function fakeConnection(forwardOut: ForwardOut | null): SshConnection {
  const connection = {
    getState: () => ({ status: 'connected' }),
    getClient: () => (forwardOut ? { forwardOut } : null)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the opener only calls getState/getClient().forwardOut, and the fake provider below never reads the connection.
  return connection as unknown as SshConnection
}

function setup(options: { label?: string | null; forwardOut?: ForwardOut | null } = {}) {
  const started: PortForwardStartOptions[] = []
  const closed: string[] = []
  const resets: AbortController[] = []
  const released: string[] = []
  const provider: SshPortForwardProvider = {
    canHandle: () => true,
    start: async (_conn, forward) => {
      started.push(forward)
      const { id, connectionId, localPort, remoteHost, remotePort } = forward
      return {
        entry: { id, connectionId, localPort, remoteHost, remotePort },
        close: async () => void closed.push(id),
        dispose: () => undefined
      }
    }
  }
  const deps: DatabaseTunnelDeps = {
    targetLabel: () => (options.label === undefined ? 'bastion' : options.label),
    acquireConnection: async () => ({
      connection: fakeConnection(options.forwardOut ?? null),
      release: () => void released.push('ssh-1')
    }),
    watchConnection: (_targetId, controller) => {
      resets.push(controller)
      return () => undefined
    },
    freeLoopbackPort: async () => 41000,
    createForwards: (callbacks) => new SshPortForwardManager(callbacks, [provider])
  }
  return { open: createDatabaseTunnelOpener(deps), started, closed, resets, released }
}

const request = { key: 'conn-1', targetId: 'ssh-1', remoteHost: 'db.internal', remotePort: 5432 }

describe('database SSH tunnels', () => {
  it('forwards a free local port to the database as the SSH host sees it, until closed', async () => {
    const { open, started, closed, released } = setup()
    const tunnel = await open(request, () => undefined)
    expect(tunnel.localPort).toBe(41000)
    expect(started[0]).toMatchObject({
      localPort: 41000,
      remoteHost: 'db.internal',
      remotePort: 5432
    })
    await tunnel.close()
    expect(closed).toHaveLength(1)
    expect(released).toEqual(['ssh-1'])
  })

  it('gives the SSH host’s reason when it cannot reach the database', async () => {
    const { open, started } = setup({
      forwardOut: (_srcHost, _srcPort, _host, _port, callback) =>
        callback(new Error('Connection refused'), { close: () => undefined })
    })
    await expect(open(request, () => undefined)).rejects.toThrow(
      'the SSH host could not reach db.internal:5432 (Connection refused)'
    )
    expect(started).toEqual([])
  })

  it('reports the tunnel lost when its SSH connection is reset', async () => {
    const { open, resets, closed } = setup()
    const lost: string[] = []
    await open(request, (message) => lost.push(message))
    resets[0]?.abort()
    expect(lost).toEqual([
      'the SSH connection to bastion was reset, so its tunnel is no longer available.'
    ])
    await Promise.resolve()
    expect(closed).toHaveLength(1)
  })

  it('reports the tunnel lost when the system ssh forward stops', async () => {
    const { open, started } = setup()
    const lost: string[] = []
    await open(request, (message) => lost.push(message))
    const forward = started[0]!
    forward.onUnexpectedClose?.(
      {
        id: forward.id,
        connectionId: forward.connectionId,
        localPort: 41000,
        remoteHost: 'db.internal',
        remotePort: 5432
      },
      { kind: 'unexpected-exit', detail: 'ssh exited with code 255' }
    )
    expect(lost).toEqual(['the SSH tunnel through bastion stopped (ssh exited with code 255).'])
  })

  it('refuses a connection whose SSH host was removed', async () => {
    const { open } = setup({ label: null })
    await expect(open(request, () => undefined)).rejects.toThrow('removed')
  })
})
