import type { DatabasePasswordStorage } from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import type { DatabaseEncryptionStatus } from '../../shared/database/database-session-types'
import type { SecretStore } from '../../shared/secret-store'
import { SealedSecretFile } from '../sealed-secret-file'

const UNREADABLE_VAULT =
  'The saved-password file exists but could not be read; refusing to overwrite it.'

export const NO_SECURE_PASSWORD_STORAGE =
  'This system has no secure password storage. Choose "Until Orca quits" or "Never" instead.'

/**
 * Database passwords: `forever` is sealed with the OS keychain (never plaintext),
 * `session` lives in memory until Orca quits, `never` is not kept at all.
 */
export class DatabasePasswordVault {
  private readonly sessionPasswords = new Map<string, string>()
  private readonly sealed: SealedSecretFile

  constructor(
    filePath: string,
    private readonly secretStore: () => SecretStore
  ) {
    this.sealed = new SealedSecretFile(filePath, secretStore)
  }

  encryptionStatus(): DatabaseEncryptionStatus {
    const store = this.secretStore()
    return {
      canStorePasswords: store.isEncryptionAvailable(),
      protectionGap: store.describeProtectionGap()
    }
  }

  has(connectionId: string): boolean {
    return this.sessionPasswords.has(connectionId) || this.sealed.has(connectionId)
  }

  get(connectionId: string): string | null {
    return this.sessionPasswords.get(connectionId) ?? this.sealed.get(connectionId)
  }

  remember(
    connectionId: string,
    storage: DatabasePasswordStorage,
    password: string
  ): DatabaseResult<null> {
    if (storage === 'never') {
      return this.forget(connectionId)
    }
    if (storage === 'session') {
      const cleared = this.deleteSealed(connectionId)
      this.sessionPasswords.set(connectionId, password)
      return cleared
    }
    const sealed = this.sealed.seal(connectionId, password)
    if (sealed === 'no-encryption') {
      return { ok: false, error: { message: NO_SECURE_PASSWORD_STORAGE, code: 'unavailable' } }
    }
    if (sealed === 'unreadable') {
      return { ok: false, error: { message: UNREADABLE_VAULT, code: 'unavailable' } }
    }
    this.sessionPasswords.delete(connectionId)
    return { ok: true, value: null }
  }

  /** Keeps a prompted password for this run without persisting it (storage `session`). */
  rememberForSession(connectionId: string, password: string): void {
    this.sessionPasswords.set(connectionId, password)
  }

  forget(connectionId: string): DatabaseResult<null> {
    this.sessionPasswords.delete(connectionId)
    return this.deleteSealed(connectionId)
  }

  private deleteSealed(connectionId: string): DatabaseResult<null> {
    return this.sealed.delete(connectionId)
      ? { ok: true, value: null }
      : { ok: false, error: { message: UNREADABLE_VAULT, code: 'unavailable' } }
  }
}
