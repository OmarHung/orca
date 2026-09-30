import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DatabaseConnection,
  DatabaseConnectionDraft
} from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import { saveConnectionWithPassword } from './database-connection-save'
import { DatabaseConnectionStore } from './database-connection-store'

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
    connections = new DatabaseConnectionStore(join(dir, 'connections.json'))
    undo = vi.fn<() => string | null>(() => null)
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

  it('puts the password back even when restoring the connection fails', () => {
    const previous = connections.save(undefined, { ...draft, passwordStorage: 'never' })
    let saves = 0
    const flaky: Deps['connections'] = {
      save: (id, next) => {
        saves += 1
        if (saves > 1) {
          throw new Error('settings locked')
        }
        return connections.save(id, next)
      },
      delete: (id) => connections.delete(id)
    }

    const failure = failureOf(() =>
      saveConnectionWithPassword(
        { connections: flaky, passwords: passwords({ keep: failures.throws }) },
        previous,
        draft,
        'forever',
        'new'
      )
    )

    expect(failure).toContain('fsync failed')
    expect(failure).toContain('settings locked')
    expect(undo).toHaveBeenCalledOnce()
  })

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
})
