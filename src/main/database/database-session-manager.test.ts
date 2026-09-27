import { describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import type { DatabaseSessionEvent } from '../../shared/database/database-session-types'
import type { DatabaseWorkerPort } from './database-worker-client'
import {
  DatabaseSessionManager,
  type DatabaseTunnel,
  type OpenDatabaseTunnel
} from './database-session-manager'
import type {
  DatabaseWorkerCommand,
  DatabaseWorkerMessage
} from './worker/database-worker-protocol'

const connection: DatabaseConnection = {
  id: 'conn-0001',
  driver: 'postgres',
  name: 'Local',
  host: 'localhost',
  port: 5432,
  database: 'app',
  user: 'dev',
  sslMode: 'disable',
  readOnly: false,
  passwordStorage: 'never',
  createdAt: 0,
  updatedAt: 0
}

type FakeWorker = {
  port: DatabaseWorkerPort
  commands: DatabaseWorkerCommand[]
  crash: (reason: string) => void
  loseConnection: (message: string) => void
  terminated: () => boolean
}

function createFakeWorker(
  answer: (command: DatabaseWorkerCommand) => DatabaseResult<unknown>
): FakeWorker {
  const commands: DatabaseWorkerCommand[] = []
  let onMessage: (message: DatabaseWorkerMessage) => void = () => undefined
  let onStop: (reason: string) => void = () => undefined
  let terminated = false
  return {
    commands,
    terminated: () => terminated,
    crash: (reason) => onStop(reason),
    loseConnection: (message) => onMessage({ kind: 'connection-lost', message }),
    port: {
      postMessage: (request) => {
        commands.push(request.command)
        queueMicrotask(() =>
          onMessage({ kind: 'response', id: request.id, result: answer(request.command) })
        )
      },
      onMessage: (listener) => {
        onMessage = listener
      },
      onStop: (listener) => {
        onStop = listener
      },
      terminate: async () => {
        terminated = true
      }
    }
  }
}

const connectOk = (command: DatabaseWorkerCommand): DatabaseResult<unknown> =>
  command.type === 'connect'
    ? { ok: true, value: { serverVersion: '17.0' } }
    : { ok: true, value: null }

function setup(
  answer = connectOk,
  openTunnel?: OpenDatabaseTunnel
): {
  manager: DatabaseSessionManager
  events: DatabaseSessionEvent[]
  workers: FakeWorker[]
} {
  const events: DatabaseSessionEvent[] = []
  const workers: FakeWorker[] = []
  const manager = new DatabaseSessionManager({
    spawnWorker: () => {
      const worker = createFakeWorker(answer)
      workers.push(worker)
      return worker.port
    },
    emit: (event) => events.push(event),
    openTunnel
  })
  return { manager, events, workers }
}

const tunneled: DatabaseConnection = {
  ...connection,
  host: 'db.internal',
  sshTunnel: { targetId: 'ssh-1' }
}

function fakeTunnels(): {
  open: OpenDatabaseTunnel
  requests: Parameters<OpenDatabaseTunnel>[0][]
  lose: (message: string) => void
  closed: () => number
} {
  const requests: Parameters<OpenDatabaseTunnel>[0][] = []
  let onLost: (message: string) => void = () => undefined
  let closed = 0
  return {
    requests,
    lose: (message) => onLost(message),
    closed: () => closed,
    open: async (request, lost) => {
      requests.push(request)
      onLost = lost
      const tunnel: DatabaseTunnel = {
        localPort: 40123,
        close: async () => {
          closed += 1
        }
      }
      return tunnel
    }
  }
}

describe('DatabaseSessionManager SSH tunnels', () => {
  it('dials the worker through the tunnel and closes it on disconnect', async () => {
    const tunnels = fakeTunnels()
    const { manager, workers } = setup(connectOk, tunnels.open)
    expect((await manager.connect(tunneled, 'pw')).ok).toBe(true)
    expect(tunnels.requests).toEqual([
      { key: tunneled.id, targetId: 'ssh-1', remoteHost: 'db.internal', remotePort: 5432 }
    ])
    expect(workers[0]?.commands[0]).toMatchObject({ type: 'connect', tunnelPort: 40123 })
    await manager.disconnect(tunneled.id)
    expect(tunnels.closed()).toBe(1)
  })

  it('reports a tunnel that could not open without dialing the server', async () => {
    const { manager, events, workers } = setup(connectOk, async () => {
      throw new Error('authentication failed')
    })
    const result = await manager.connect(tunneled, null)
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'SSH tunnel: authentication failed' }
    })
    expect(workers[0]?.commands).toEqual([])
    expect(workers[0]?.terminated()).toBe(true)
    expect(events.at(-1)).toMatchObject({
      state: 'error',
      message: 'SSH tunnel: authentication failed'
    })
  })

  it('drops the session when its tunnel goes away', async () => {
    const tunnels = fakeTunnels()
    const { manager, events, workers } = setup(connectOk, tunnels.open)
    await manager.connect(tunneled, null)
    tunnels.lose('The SSH connection was reset')
    expect(manager.isConnected(tunneled.id)).toBe(false)
    expect(workers[0]?.terminated()).toBe(true)
    expect(events.at(-1)).toMatchObject({
      state: 'error',
      message: 'Connection lost: The SSH connection was reset'
    })
  })

  it('closes the tunnel when the server refuses the connection', async () => {
    const tunnels = fakeTunnels()
    const { manager } = setup(
      () => ({ ok: false, error: { message: 'password authentication failed' } }),
      tunnels.open
    )
    expect((await manager.connect(tunneled, 'wrong')).ok).toBe(false)
    expect(tunnels.closed()).toBe(1)
  })

  it('opens a throwaway tunnel for a connection test', async () => {
    const tunnels = fakeTunnels()
    const { manager } = setup(connectOk, tunnels.open)
    expect((await manager.test(tunneled, null)).ok).toBe(true)
    expect(tunnels.requests[0]?.key).toMatch(/^test:/)
    expect(tunnels.closed()).toBe(1)
  })
})

describe('DatabaseSessionManager', () => {
  it('connects once even when asked twice concurrently', async () => {
    const { manager, events, workers } = setup()
    const [first, second] = await Promise.all([
      manager.connect(connection, null),
      manager.connect(connection, null)
    ])
    expect(first).toEqual(second)
    expect(workers).toHaveLength(1)
    expect(events.map((event) => event.state)).toEqual(['connecting', 'connected'])
    expect(manager.isConnected(connection.id)).toBe(true)
  })

  it('reports not-connected for requests before connecting', async () => {
    const { manager } = setup()
    const result = await manager.request(connection.id, { type: 'cancel', consoleId: 'console-1' })
    expect(result).toMatchObject({ ok: false, error: { code: 'not-connected' } })
  })

  it('drops the session and terminates the worker when connect fails', async () => {
    const { manager, events, workers } = setup(() => ({
      ok: false,
      error: { message: 'password authentication failed' }
    }))
    const result = await manager.connect(connection, null)
    expect(result.ok).toBe(false)
    expect(workers[0]?.terminated()).toBe(true)
    expect(events.at(-1)).toMatchObject({
      state: 'error',
      message: 'password authentication failed'
    })
    expect(manager.isConnected(connection.id)).toBe(false)
  })

  it('marks the session lost when the server drops or the worker dies', async () => {
    const { manager, events, workers } = setup()
    await manager.connect(connection, null)
    workers[0]?.loseConnection('terminating connection due to administrator command')
    expect(manager.isConnected(connection.id)).toBe(false)
    expect(events.at(-1)).toMatchObject({ state: 'error' })

    await manager.connect(connection, null)
    const pending = manager.request(connection.id, { type: 'cancel', consoleId: 'console-1' })
    workers[1]?.crash('out of memory')
    expect(manager.isConnected(connection.id)).toBe(false)
    // A dead worker must settle in-flight requests instead of leaving them hanging.
    expect(await pending).toMatchObject({ ok: false, error: { code: 'unavailable' } })
  })

  it('says why a session was lost while it was still connecting', async () => {
    let lose: (message: string) => void = () => undefined
    const { manager, events, workers } = setup((command) => {
      if (command.type === 'connect') {
        lose('the SSH tunnel stopped')
      }
      return connectOk(command)
    })
    lose = (message) => workers[0]?.loseConnection(message)
    const expected = { message: 'Connection lost: the SSH tunnel stopped' }
    expect(await manager.connect(connection, null)).toMatchObject({ ok: false, error: expected })
    expect(events.at(-1)).toMatchObject({ state: 'error', ...expected })
    expect(manager.isConnected(connection.id)).toBe(false)
  })

  it('does not repeat "Connection lost" when the driver already says it', async () => {
    const { manager, events, workers } = setup()
    await manager.connect(connection, null)
    workers[0]?.loseConnection('Connection lost: The server closed the connection.')
    expect(events.at(-1)).toMatchObject({
      message: 'Connection lost: The server closed the connection.'
    })
  })

  it('closes the server session before terminating on disconnect', async () => {
    const { manager, events, workers } = setup()
    await manager.connect(connection, null)
    await manager.disconnect(connection.id)
    expect(workers[0]?.commands.map((command) => command.type)).toEqual(['connect', 'close'])
    expect(workers[0]?.terminated()).toBe(true)
    expect(events.at(-1)).toMatchObject({ state: 'disconnected' })
  })

  it('restarts a session so a blocked statement settles as cancelled', async () => {
    const { manager, events, workers } = setup((command) =>
      command.type === 'connect' ? connectOk(command) : { ok: true, value: null }
    )
    await manager.connect(connection, null)
    // A worker blocked in a synchronous statement never answers this request.
    workers[0]!.port.postMessage = () => undefined
    const running = manager.request(connection.id, { type: 'cancel', consoleId: 'console-1' })
    const restarted = await manager.restart(connection.id, {
      message: 'Cancelled',
      code: 'cancelled'
    })
    expect(restarted).toBe(true)
    expect(await running).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(workers[0]?.terminated()).toBe(true)
    expect(events.at(-1)).toMatchObject({ state: 'disconnected' })
    expect(manager.isConnected(connection.id)).toBe(false)
  })

  it('tests connections in a throwaway worker', async () => {
    const { manager, workers } = setup()
    const result = await manager.test(connection, 'pw')
    expect(result.ok).toBe(true)
    expect(workers[0]?.terminated()).toBe(true)
    expect(manager.isConnected(connection.id)).toBe(false)
  })
})
