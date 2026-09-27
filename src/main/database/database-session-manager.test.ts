import { describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import type { DatabaseSessionEvent } from '../../shared/database/database-session-types'
import type { DatabaseWorkerPort } from './database-worker-client'
import { DatabaseSessionManager } from './database-session-manager'
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

function setup(answer = connectOk): {
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
    emit: (event) => events.push(event)
  })
  return { manager, events, workers }
}

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
