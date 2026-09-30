import type { DatabasePasswordStorage } from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import type { DatabaseEncryptionStatus } from '../../shared/database/database-session-types'
import type { SecretStore } from '../../shared/secret-store'
import { KeptPasswords } from '../kept-passwords'

export const NO_SECURE_PASSWORD_STORAGE =
  'This system has no secure password storage. Choose "Until Orca quits" or "Never" instead.'

function toResult(problem: string | null): DatabaseResult<null> {
  return problem === null
    ? { ok: true, value: null }
    : { ok: false, error: { message: problem, code: 'unavailable' } }
}

/**
 * Database passwords, by connection id (see KeptPasswords). A failed change reports why and
 * changed nothing on disk.
 */
export class DatabasePasswordVault {
  private readonly passwords: KeptPasswords

  constructor(
    filePath: string,
    private readonly secretStore: () => SecretStore
  ) {
    this.passwords = new KeptPasswords(filePath, secretStore, NO_SECURE_PASSWORD_STORAGE)
  }

  encryptionStatus(): DatabaseEncryptionStatus {
    const store = this.secretStore()
    return {
      canStorePasswords: store.isEncryptionAvailable(),
      protectionGap: store.describeProtectionGap()
    }
  }

  has(connectionId: string): boolean {
    return this.passwords.has(connectionId)
  }

  get(connectionId: string): string | null {
    return this.passwords.get(connectionId)
  }

  remember(
    connectionId: string,
    storage: DatabasePasswordStorage,
    password: string
  ): DatabaseResult<null> {
    return toResult(this.passwords.remember(connectionId, storage, password))
  }

  /** Keeps a prompted password for this run without persisting it (storage `session`). */
  rememberForSession(connectionId: string, password: string): void {
    this.passwords.rememberForSession(connectionId, password)
  }

  forget(connectionId: string): DatabaseResult<null> {
    return toResult(this.passwords.forget(connectionId))
  }

  /**
   * Before a setting change is saved. `password`: a new one, `null` to clear it, or `undefined`
   * to keep the one already kept. The value puts the passwords back if saving then fails.
   */
  release(
    connectionId: string,
    storage: DatabasePasswordStorage,
    password: string | null | undefined
  ): DatabaseResult<() => string | null> {
    const released = this.passwords.release(connectionId, storage, password)
    return released.ok
      ? { ok: true, value: released.undo }
      : { ok: false, error: { message: released.problem, code: 'unavailable' } }
  }

  /** After a setting change is saved. */
  keep(
    connectionId: string,
    storage: DatabasePasswordStorage,
    password: string | null | undefined
  ): DatabaseResult<null> {
    return toResult(this.passwords.keep(connectionId, storage, password))
  }
}
