import { describe, expect, it, vi } from 'vitest'
import type { SshConnectionState, SshConnectionStatus, SshTarget } from '../../shared/ssh-types'
import type { SshConnection } from '../ssh/ssh-connection'
import type { SshConnectionCallbacks } from '../ssh/ssh-connection-utils'
import { DatabaseSshConnections } from './database-ssh-connections'

vi.mock('../ipc/ssh-ipc-context', () => ({ getCurrentMainWindow: () => null }))
vi.mock('../ipc/ssh-passphrase', () => ({ requestCredential: async () => null }))

const stateOf = (status: SshConnectionStatus): SshConnectionState => ({
  targetId: 'ssh-1',
  status,
  error: null,
  reconnectAttempt: 0
})

type FakeLink = {
  callbacks: SshConnectionCallbacks
  disconnects: number
  fail: boolean
}

function setup(options: { fail?: boolean; target?: boolean } = {}) {
  const created: FakeLink[] = []
  const pool = new DatabaseSshConnections({
    findTarget: (id) =>
      options.target === false
        ? undefined
        : ({
            id,
            label: 'bastion',
            host: 'bastion',
            port: 22,
            username: 'root'
          } satisfies SshTarget),
    createConnection: (_target, callbacks) => {
      const fake: FakeLink = { callbacks, disconnects: 0, fail: options.fail ?? false }
      created.push(fake)
      let status: SshConnectionStatus = 'disconnected'
      const connection = {
        connect: async () => {
          if (fake.fail) {
            throw new Error('auth failed')
          }
          status = 'connected'
        },
        disconnect: async () => {
          fake.disconnects += 1
          status = 'disconnected'
        },
        getState: () => stateOf(status),
        getClient: () => null
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the pool only calls connect, disconnect, getState and getClient.
      return connection as unknown as SshConnection
    }
  })
  return { pool, created }
}

describe('DatabaseSshConnections', () => {
  it('shares one link per SSH host and closes it with the last tunnel', async () => {
    const { pool, created } = setup()
    const first = await pool.acquire('ssh-1')
    const second = await pool.acquire('ssh-1')
    expect(created).toHaveLength(1)
    first.release()
    first.release()
    expect(created[0]?.disconnects).toBe(0)
    second.release()
    expect(created[0]?.disconnects).toBe(1)
  })

  it('ends the tunnels watching a link that drops, instead of reconnecting it', async () => {
    const { pool, created } = setup()
    await pool.acquire('ssh-1')
    const controller = new AbortController()
    pool.watch('ssh-1', controller)
    created[0]?.callbacks.onStateChange('ssh-1', stateOf('reconnecting'))
    expect(controller.signal.aborted).toBe(true)
    expect(created[0]?.disconnects).toBe(1)
    // The next tunnel gets a fresh link.
    await pool.acquire('ssh-1')
    expect(created).toHaveLength(2)
  })

  it('stops a failed attempt from retrying, and refuses a removed host', async () => {
    const failing = setup({ fail: true })
    await expect(failing.pool.acquire('ssh-1')).rejects.toThrow('auth failed')
    await Promise.resolve()
    expect(failing.created[0]?.disconnects).toBe(1)
    await expect(setup({ target: false }).pool.acquire('ssh-1')).rejects.toThrow(/removed/)
  })
})
