import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  databasePasswordStorage,
  type DatabaseConnection,
  type DatabaseConnectionDraft,
  type DatabasePasswordStorage
} from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import { rollBack, type SettingRollback } from '../kept-passwords'
import type { DatabaseConnectionStore } from './database-connection-store'
import type { DatabasePasswordVault } from './database-password-vault'

type SaveDeps = {
  connections: Pick<DatabaseConnectionStore, 'get' | 'save' | 'delete'>
  passwords: Pick<DatabasePasswordVault, 'release' | 'keep' | 'remember' | 'rememberForSession'>
}

/**
 * Saves a connection and moves its password to where the setting keeps it: removals before the
 * connection is saved, sealing after it. Any failure takes the change back, so a failed save never
 * loses a password or keeps one the saved connection did not ask for. `password`: a new one,
 * `null` to clear it, or `undefined` to keep (or move) the one already kept.
 */
export function saveConnectionWithPassword(
  deps: SaveDeps,
  previous: DatabaseConnection | null,
  draft: DatabaseConnectionDraft,
  storage: DatabasePasswordStorage,
  password: string | null | undefined
): DatabaseResult<DatabaseConnection> {
  return previous
    ? saveExistingConnection(deps, previous, draft, storage, password)
    : saveNewConnection(deps, draft, storage, password)
}

function saveExistingConnection(
  { connections, passwords }: SaveDeps,
  previous: DatabaseConnection,
  draft: DatabaseConnectionDraft,
  storage: DatabasePasswordStorage,
  password: string | null | undefined
): DatabaseResult<DatabaseConnection> {
  const released = passwords.release(previous.id, storage, password)
  if (!released.ok) {
    return released
  }
  const undo = released.value
  const setting: SettingRollback = {
    // Why only when changed: a write that failed before replacing the file left nothing to revert.
    revert: () => {
      if (!isDeepStrictEqual(connections.get(previous.id), previous)) {
        connections.save(previous.id, previous)
      }
    },
    keepsPreviousPasswords: () => {
      const saved = connections.get(previous.id)
      return saved !== null && databasePasswordStorage(saved) === databasePasswordStorage(previous)
    }
  }
  let saved: DatabaseConnection
  let kept: DatabaseResult<null>
  try {
    saved = connections.save(previous.id, draft)
    kept = passwords.keep(previous.id, storage, password)
  } catch (error) {
    throw rollBack(error, undo, setting)
  }
  if (!kept.ok) {
    const message = rollBack(new Error(kept.error.message), undo, setting).message
    return { ok: false, error: { ...kept.error, message } }
  }
  return { ok: true, value: saved }
}

/** A new connection has nothing saved to move or remove, so only a typed password is kept. */
function saveNewConnection(
  { connections, passwords }: SaveDeps,
  draft: DatabaseConnectionDraft,
  storage: DatabasePasswordStorage,
  password: string | null | undefined
): DatabaseResult<DatabaseConnection> {
  // Why chosen here: a write can fail after it replaced the file, and only the id finds it then.
  const id = randomUUID()
  // Why nothing to undo: a failed remember already put the password file back.
  const discard = (error: unknown): Error =>
    rollBack(error, () => null, {
      revert: () => connections.delete(id),
      keepsPreviousPasswords: () => true
    })
  let created: DatabaseConnection
  let sealed: DatabaseResult<null> = { ok: true, value: null }
  try {
    created = connections.save(id, draft)
    if (typeof password === 'string' && storage === 'session') {
      passwords.rememberForSession(id, password)
    }
    if (typeof password === 'string' && storage === 'forever') {
      sealed = passwords.remember(id, 'forever', password)
    }
  } catch (error) {
    throw discard(error)
  }
  if (!sealed.ok) {
    return {
      ok: false,
      error: { ...sealed.error, message: discard(new Error(sealed.error.message)).message }
    }
  }
  return { ok: true, value: created }
}
