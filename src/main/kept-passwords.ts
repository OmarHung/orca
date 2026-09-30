import type { SecretStore } from '../shared/secret-store'
import { SealedSecretFile } from './sealed-secret-file'

/** How a saved login keeps its password; the database and VPN settings share these values. */
export type PasswordStorage = 'forever' | 'session' | 'never'

const LOCKED_MESSAGE =
  'The saved password cannot be read right now because the system keychain is locked or unavailable. Enter the password again, or try again later.'

/**
 * Passwords by id: `forever` sealed with the OS keychain in a file (never plaintext), `session` in
 * memory until Orca quits, `never` not kept. Methods that change what is kept return a user-facing
 * problem, or null once done; on a problem nothing on disk was changed.
 *
 * A setting change runs in two halves around saving the setting itself: `release` before it
 * removes what the new setting must not keep, and `keep` after it seals what the new setting
 * keeps. So a failed save of the setting never leaves a password on disk it did not ask for.
 */
export class KeptPasswords {
  private readonly session = new Map<string, string>()
  private readonly sealed: SealedSecretFile

  constructor(
    filePath: string,
    private readonly secretStore: () => SecretStore,
    private readonly noEncryptionMessage: string
  ) {
    this.sealed = new SealedSecretFile(filePath, secretStore)
  }

  canSeal(): boolean {
    return this.secretStore().isEncryptionAvailable()
  }

  get(id: string): string | null {
    return this.session.get(id) ?? this.sealed.get(id)
  }

  has(id: string): boolean {
    return this.session.has(id) || this.sealed.has(id)
  }

  ids(): string[] {
    return [...new Set([...this.session.keys(), ...(this.sealed.ids() ?? [])])]
  }

  rememberForSession(id: string, password: string): void {
    this.session.set(id, password)
  }

  forget(id: string): string | null {
    this.session.delete(id)
    return this.deleteSealed(id)
  }

  /** Keeps a password just typed the way `storage` says, replacing whatever was kept. */
  remember(id: string, storage: PasswordStorage, password: string): string | null {
    return storage === 'forever' ? this.seal(id, password) : this.release(id, storage, password)
  }

  /**
   * First half of a setting change. `password` is a new one, `null` clears it, and `undefined`
   * keeps the one already kept. For `session` a saved copy moves into memory, and a copy the
   * keychain cannot open now is refused rather than dropped.
   */
  release(
    id: string,
    storage: PasswordStorage,
    password: string | null | undefined
  ): string | null {
    if (password === null || storage === 'never') {
      return this.forget(id)
    }
    if (storage === 'forever') {
      return null
    }
    let kept = password ?? this.session.get(id)
    if (kept === undefined) {
      const found = this.sealed.lookup(id)
      if (found.state === 'unavailable') {
        return LOCKED_MESSAGE
      }
      if (found.state === 'problem') {
        return this.sealed.describeProblem(found.problem)
      }
      kept = found.state === 'available' ? found.secret : undefined
    }
    const removed = this.deleteSealed(id)
    if (removed === null && kept !== undefined) {
      this.session.set(id, kept)
    }
    return removed
  }

  /** Second half of a setting change: seals a new or in-memory password for `forever`. */
  keep(id: string, storage: PasswordStorage, password: string | null | undefined): string | null {
    if (storage !== 'forever' || password === null) {
      return null
    }
    const kept = password ?? this.session.get(id)
    // Why: with nothing new, the copy already saved stays untouched, even if the keychain is locked.
    return kept === undefined ? null : this.seal(id, kept)
  }

  private seal(id: string, password: string): string | null {
    const sealed = this.sealed.seal(id, password)
    if (sealed === 'no-encryption') {
      return this.noEncryptionMessage
    }
    if (sealed !== 'sealed') {
      return this.sealed.describeProblem(sealed)
    }
    this.session.delete(id)
    return null
  }

  private deleteSealed(id: string): string | null {
    const deleted = this.sealed.delete(id)
    return deleted === 'deleted' ? null : this.sealed.describeProblem(deleted)
  }
}
