import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseConnectionDraft } from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import type { SecretStore } from '../../shared/secret-store'
import { DatabaseConnectionStore } from './database-connection-store'
import { DatabaseConsoleFiles } from './database-console-files'
import { DatabasePasswordVault } from './database-password-vault'
import { DatabaseQueryHistory } from './database-query-history'
import { DatabaseService } from './database-service'
import { DatabaseSessionManager } from './database-session-manager'
import type {
  DatabaseWorkerCommand,
  DatabaseWorkerMessage
} from './worker/database-worker-protocol'

const draft: DatabaseConnectionDraft = {
  driver: 'postgres',
  name: 'Local',
  host: 'localhost',
  port: 5432,
  database: 'app',
  user: 'dev',
  sslMode: 'disable',
  passwordStorage: 'forever'
}

function secretStore(available: boolean): SecretStore {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(text),
    decryptString: (cipher) => cipher.toString(),
    describeProtectionGap: () => null
  }
}

describe('DatabaseService', () => {
  let dir: string
  let connectPasswords: (string | null)[]
  let workerCommands: string[]
  let acceptedPassword: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-db-service-'))
    connectPasswords = []
    workerCommands = []
    acceptedPassword = 'right'
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function answer(command: DatabaseWorkerCommand): DatabaseResult<unknown> {
    workerCommands.push(command.type)
    if (command.type !== 'connect') {
      return { ok: true, value: null }
    }
    connectPasswords.push(command.password)
    return command.password === acceptedPassword
      ? { ok: true, value: { serverVersion: '17.0' } }
      : { ok: false, error: { message: 'password authentication failed', sqlState: '28P01' } }
  }

  function createService(encryption = true): DatabaseService {
    return new DatabaseService({
      connections: new DatabaseConnectionStore(join(dir, 'connections.json')),
      passwords: new DatabasePasswordVault(join(dir, 'passwords.json'), () =>
        secretStore(encryption)
      ),
      consoles: new DatabaseConsoleFiles(join(dir, 'consoles')),
      history: new DatabaseQueryHistory(join(dir, 'history')),
      sessions: new DatabaseSessionManager({
        emit: () => undefined,
        spawnWorker: () => {
          let onMessage: (message: DatabaseWorkerMessage) => void = () => undefined
          return {
            postMessage: (request) =>
              queueMicrotask(() =>
                onMessage({ kind: 'response', id: request.id, result: answer(request.command) })
              ),
            onMessage: (listener) => {
              onMessage = listener
            },
            onStop: () => undefined,
            terminate: async () => undefined
          }
        }
      })
    })
  }

  it('asks for a password when the server rejects the saved one', async () => {
    const service = createService()
    const saved = await service.saveConnection({ draft, password: 'wrong' })
    expect(saved.ok).toBe(true)
    if (!saved.ok) {
      return
    }
    const result = await service.connect(saved.value.id)
    expect(result).toMatchObject({ ok: false, error: { code: 'password-required' } })

    const retried = await service.connect(saved.value.id, 'right')
    expect(retried.ok).toBe(true)
    expect(connectPasswords).toEqual(['wrong', 'right'])
    // The prompted password replaces the stale one for a "forever" connection.
    expect(createService().listConnections()[0]?.hasSavedPassword).toBe(true)
  })

  it('refuses a "forever" password without OS encryption and saves nothing', async () => {
    const service = createService(false)
    const result = await service.saveConnection({ draft, password: 'secret' })
    expect(result.ok).toBe(false)
    expect(service.listConnections()).toEqual([])
  })

  it('moves the saved password when the storage mode changes', async () => {
    const service = createService()
    const saved = await service.saveConnection({ draft, password: 'secret' })
    if (!saved.ok) {
      throw new Error(saved.error.message)
    }
    const never = await service.saveConnection({
      id: saved.value.id,
      draft: { ...draft, passwordStorage: 'never' }
    })
    expect(never.ok && never.value.hasSavedPassword).toBe(false)
  })

  it('reconnects with new settings saved while connected, but keeps the session on a rename', async () => {
    const service = createService()
    const saved = await service.saveConnection({ draft, password: 'right' })
    if (!saved.ok) {
      throw new Error(saved.error.message)
    }
    const id = saved.value.id
    expect((await service.connect(id)).ok).toBe(true)

    await service.saveConnection({ id, draft: { ...draft, name: 'Renamed', color: '#ef4444' } })
    expect((await service.connect(id)).ok).toBe(true)
    expect(connectPasswords).toHaveLength(1)

    await service.saveConnection({ id, draft: { ...draft, name: 'Renamed', port: 5433 } })
    expect((await service.connect(id)).ok).toBe(true)
    expect(connectPasswords).toHaveLength(2)
  })

  it('round-trips console text', async () => {
    const service = createService()
    const ref = { connectionId: 'conn-0001', consoleId: 'console-01' }
    expect(await service.readConsole(ref)).toBe('')
    service.writeConsole(ref, 'select 1;')
    expect(await service.readConsole(ref)).toBe('select 1;')
  })

  it('records console runs in history but not table queries, and forgets them with the connection', async () => {
    const service = createService()
    const saved = await service.saveConnection({ draft, password: 'right' })
    if (!saved.ok) {
      throw new Error(saved.error.message)
    }
    const id = saved.value.id
    expect((await service.connect(id)).ok).toBe(true)
    const ref = { connectionId: id, consoleId: 'console-01', pageSize: 10 }
    await service.execute({ ...ref, sql: 'select 1', recordHistory: true })
    await service.execute({ ...ref, sql: 'select * from t limit 10' })
    expect(await service.listHistory(id)).toMatchObject([{ sql: 'select 1', outcome: 'ok' }])

    await service.deleteConnection(id)
    expect(await service.listHistory(id)).toEqual([])
  })
})
