import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  databasePasswordStorage,
  type DatabaseConnection,
  type DatabaseConnectionDraft,
  type DatabasePasswordStorage
} from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import type { SecretStore } from '../../shared/secret-store'
import { clearDurableWrites, queueDurableWrites } from '../durable-write-failures-test-support'
import { saveConnectionWithPassword } from './database-connection-save'
import { DatabaseConnectionStore } from './database-connection-store'
import { DatabasePasswordVault } from './database-password-vault'

vi.mock('../../shared/secure-file', async (importOriginal) => {
  const { withQueuedDurableWrites } = await import('../durable-write-failures-test-support')
  return withQueuedDurableWrites(await importOriginal())
})

type Deps = Parameters<typeof saveConnectionWithPassword>[0]

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

const PROBLEM: DatabaseResult<null> = {
  ok: false,
  error: { message: 'fsync failed', code: 'unavailable' }
}

const failures = {
  throws: (): DatabaseResult<null> => {
    throw new Error('fsync failed')
  },
  'reports a problem': (): DatabaseResult<null> => PROBLEM
}

const secretStore = (): SecretStore => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`sealed:${plain}`),
  decryptString: (cipher) => cipher.toString().replace(/^sealed:/, ''),
  describeProtectionGap: () => null
})

/** The message a failed save reports, whether it threw or returned it. */
function failureOf(save: () => DatabaseResult<DatabaseConnection>): string {
  try {
    const result = save()
    return result.ok ? 'saved' : result.error.message
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('saveConnectionWithPassword', () => {
  let dir: string
  let settingsPath: string
  let passwordsPath: string
  let connections: DatabaseConnectionStore
  let undo: ReturnType<typeof vi.fn<() => string | null>>

  const passwords = (overrides: Partial<Deps['passwords']>): Deps['passwords'] => ({
    release: () => ({ ok: true, value: undo }),
    keep: () => ({ ok: true, value: null }),
    remember: () => ({ ok: true, value: null }),
    rememberForSession: () => undefined,
    ...overrides
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-db-connection-save-'))
    settingsPath = join(dir, 'connections.json')
    passwordsPath = join(dir, 'passwords.json')
    connections = new DatabaseConnectionStore(settingsPath)
    undo = vi.fn<() => string | null>(() => null)
    clearDurableWrites()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it.each(Object.entries(failures))(
    'puts the connection and its password back when sealing %s',
    (_case, keep) => {
      const previous = connections.save(undefined, { ...draft, passwordStorage: 'never' })

      const failure = failureOf(() =>
        saveConnectionWithPassword(
          { connections, passwords: passwords({ keep }) },
          previous,
          draft,
          'forever',
          'new'
        )
      )

      expect(failure).toContain('fsync failed')
      expect(connections.get(previous.id)).toMatchObject({ passwordStorage: 'never' })
      expect(undo).toHaveBeenCalledOnce()
    }
  )

  it.each(Object.entries(failures))(
    'does not create a connection when sealing its password %s',
    (_case, remember) => {
      const failure = failureOf(() =>
        saveConnectionWithPassword(
          { connections, passwords: passwords({ remember }) },
          null,
          draft,
          'forever',
          'new'
        )
      )

      expect(failure).toContain('fsync failed')
      expect(connections.list()).toEqual([])
    }
  )

  describe('when a write fails after it replaced the file', () => {
    let vault: DatabasePasswordVault

    beforeEach(() => {
      vault = new DatabasePasswordVault(passwordsPath, secretStore)
    })

    const save = (
      previous: DatabaseConnection | null,
      storage: DatabasePasswordStorage,
      password: string | undefined
    ): DatabaseResult<DatabaseConnection> =>
      saveConnectionWithPassword(
        { connections, passwords: vault },
        previous,
        { ...draft, passwordStorage: storage },
        storage,
        password
      )
    const createForever = (): DatabaseConnection => {
      const created = save(null, 'forever', 'hunter2')
      if (!created.ok) {
        throw new Error(created.error.message)
      }
      return created.value
    }
    const savedStorage = (id: string): string | undefined => {
      const connection = new DatabaseConnectionStore(settingsPath).get(id)
      return connection ? databasePasswordStorage(connection) : undefined
    }
    const savedPassword = (id: string): string | null =>
      new DatabasePasswordVault(passwordsPath, secretStore).get(id)

    it.each(['session', 'never'] as const)(
      'puts the old setting and its password back when switching to %s',
      (storage) => {
        const previous = createForever()
        queueDurableWrites(settingsPath, 'throw-after')

        expect(failureOf(() => save(previous, storage, undefined))).toBe('fsync failed')

        expect(savedStorage(previous.id)).toBe('forever')
        expect(savedPassword(previous.id)).toBe('hunter2')
      }
    )

    it('reports only the failed write when the setting was never replaced', () => {
      const previous = createForever()
      queueDurableWrites(settingsPath, 'throw-before', 'throw-before')

      expect(failureOf(() => save(previous, 'never', undefined))).toBe('disk full')

      expect(savedStorage(previous.id)).toBe('forever')
      expect(savedPassword(previous.id)).toBe('hunter2')
    })

    it('keeps the password off disk while the new setting cannot be taken back', () => {
      const previous = createForever()
      queueDurableWrites(settingsPath, 'throw-after', 'throw-before')

      expect(failureOf(() => save(previous, 'never', undefined))).toBe(
        'fsync failed The previous settings could not be put back: disk full'
      )

      expect(savedStorage(previous.id)).toBe('never')
      expect(savedPassword(previous.id)).toBeNull()
    })

    it('keeps the new setting without a password when sealing fails and it cannot be taken back', () => {
      const created = save(null, 'never', undefined)
      if (!created.ok) {
        throw new Error(created.error.message)
      }
      queueDurableWrites(passwordsPath, 'throw-after')
      queueDurableWrites(settingsPath, 'ok', 'throw-before')

      expect(failureOf(() => save(created.value, 'forever', 'hunter2'))).toBe(
        'fsync failed The previous settings could not be put back: disk full'
      )

      expect(savedStorage(created.value.id)).toBe('forever')
      expect(savedPassword(created.value.id)).toBeNull()
    })

    it('leaves no connection behind when creating it fails', () => {
      queueDurableWrites(settingsPath, 'throw-after')

      expect(failureOf(() => save(null, 'forever', 'hunter2'))).toBe('fsync failed')

      expect(new DatabaseConnectionStore(settingsPath).list()).toEqual([])
    })

    it('leaves no connection or password behind when sealing a new one fails', () => {
      queueDurableWrites(passwordsPath, 'throw-after')

      expect(failureOf(() => save(null, 'forever', 'hunter2'))).toBe('fsync failed')

      expect(new DatabaseConnectionStore(settingsPath).list()).toEqual([])
      expect(JSON.parse(readFileSync(passwordsPath, 'utf8')).ciphertexts).toEqual({})
    })
  })
})
