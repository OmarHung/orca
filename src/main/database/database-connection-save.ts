import type {
  DatabaseConnection,
  DatabaseConnectionDraft,
  DatabasePasswordStorage
} from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import { afterUndo } from '../kept-passwords'
import type { DatabaseConnectionStore } from './database-connection-store'
import type { DatabasePasswordVault } from './database-password-vault'

type SaveDeps = {
  connections: Pick<DatabaseConnectionStore, 'save' | 'delete'>
  passwords: Pick<DatabasePasswordVault, 'release' | 'keep' | 'remember' | 'rememberForSession'>
}

/**
 * Saves a connection and moves its password to where the setting keeps it: removals before the
 * connection is saved, sealing after it. Any failure puts the connection and the passwords back,
 * so a failed save never loses a password or keeps one it did not ask for. `password`: a new one,
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
  let saved: DatabaseConnection
  try {
    saved = connections.save(previous.id, draft)
  } catch (error) {
    throw afterUndo(error, undo())
  }
  const kept = passwords.keep(previous.id, storage, password)
  if (!kept.ok) {
    connections.save(previous.id, previous)
    const message = afterUndo(new Error(kept.error.message), undo()).message
    return { ok: false, error: { ...kept.error, message } }
  }
  return { ok: true, value: saved }
}

/** A new connection gets a fresh id, so nothing is saved to move; only a typed password is kept. */
function saveNewConnection(
  { connections, passwords }: SaveDeps,
  draft: DatabaseConnectionDraft,
  storage: DatabasePasswordStorage,
  password: string | null | undefined
): DatabaseResult<DatabaseConnection> {
  const created = connections.save(undefined, draft)
  if (typeof password !== 'string' || storage === 'never') {
    return { ok: true, value: created }
  }
  if (storage === 'session') {
    passwords.rememberForSession(created.id, password)
    return { ok: true, value: created }
  }
  const sealed = passwords.remember(created.id, 'forever', password)
  if (!sealed.ok) {
    connections.delete(created.id)
    return sealed
  }
  return { ok: true, value: created }
}
