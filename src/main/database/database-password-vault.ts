import { existsSync, readFileSync } from 'node:fs'
import type { DatabasePasswordStorage } from '../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import type { DatabaseEncryptionStatus } from '../../shared/database/database-session-types'
import { isUnreadableError, writeDurableSecureJsonFile } from '../../shared/secure-file'
import type { SecretStore } from '../../shared/secret-store'

type VaultFile = {
  version: 1
  format: 'orca-secret-store-v1'
  /** connection id → base64 ciphertext. */
  ciphertexts: Record<string, string>
}

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

  constructor(
    private readonly filePath: string,
    private readonly secretStore: () => SecretStore
  ) {}

  encryptionStatus(): DatabaseEncryptionStatus {
    const store = this.secretStore()
    return {
      canStorePasswords: store.isEncryptionAvailable(),
      protectionGap: store.describeProtectionGap()
    }
  }

  has(connectionId: string): boolean {
    if (this.sessionPasswords.has(connectionId)) {
      return true
    }
    const file = this.read()
    return file !== null && Object.hasOwn(file.ciphertexts, connectionId)
  }

  get(connectionId: string): string | null {
    const cached = this.sessionPasswords.get(connectionId)
    if (cached !== undefined) {
      return cached
    }
    const ciphertext = this.read()?.ciphertexts[connectionId]
    if (typeof ciphertext !== 'string') {
      return null
    }
    const store = this.secretStore()
    if (!store.isEncryptionAvailable()) {
      return null
    }
    try {
      return store.decryptString(Buffer.from(ciphertext, 'base64'))
    } catch {
      // A keychain reset makes old ciphertext undecryptable; asking again is the recovery.
      return null
    }
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
    const store = this.secretStore()
    if (!store.isEncryptionAvailable()) {
      return { ok: false, error: { message: NO_SECURE_PASSWORD_STORAGE, code: 'unavailable' } }
    }
    const file = this.read()
    if (!file) {
      return { ok: false, error: { message: UNREADABLE_VAULT, code: 'unavailable' } }
    }
    const ciphertext = store.encryptString(password).toString('base64')
    this.write({ ...file, ciphertexts: { ...file.ciphertexts, [connectionId]: ciphertext } })
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
    const file = this.read()
    if (!file) {
      return { ok: false, error: { message: UNREADABLE_VAULT, code: 'unavailable' } }
    }
    if (Object.hasOwn(file.ciphertexts, connectionId)) {
      const { [connectionId]: _removed, ...rest } = file.ciphertexts
      this.write({ ...file, ciphertexts: rest })
    }
    return { ok: true, value: null }
  }

  /** `null` means the file exists but could not be read — never treat that as empty. */
  private read(): VaultFile | null {
    const empty: VaultFile = { version: 1, format: 'orca-secret-store-v1', ciphertexts: {} }
    if (!existsSync(this.filePath)) {
      return empty
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      const ciphertexts: unknown =
        typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'ciphertexts') : null
      if (typeof ciphertexts !== 'object' || ciphertexts === null || Array.isArray(ciphertexts)) {
        return empty
      }
      const entries = Object.entries(ciphertexts).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
      return { ...empty, ciphertexts: Object.fromEntries(entries) }
    } catch (error) {
      return isUnreadableError(error) ? null : empty
    }
  }

  private write(file: VaultFile): void {
    writeDurableSecureJsonFile(this.filePath, file)
  }
}
