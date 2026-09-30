import type { SshVpnPasswordStorage } from '../../shared/ssh-vpn-types'
import type { SecretStore } from '../../shared/secret-store'
import { SealedSecretFile } from '../sealed-secret-file'

/**
 * VPN login passwords, by profile id. `forever` is sealed with the OS keychain (never plaintext),
 * `session` lives in memory until Orca quits, `never` is not kept at all.
 */
export class SshVpnPasswordVault {
  private readonly sessionPasswords = new Map<string, string>()
  private readonly sealed: SealedSecretFile

  constructor(
    filePath: string,
    private readonly secretStore: () => SecretStore
  ) {
    this.sealed = new SealedSecretFile(filePath, secretStore)
  }

  canStorePasswords(): boolean {
    return this.secretStore().isEncryptionAvailable()
  }

  get(profileId: string): string | null {
    return this.sessionPasswords.get(profileId) ?? this.sealed.get(profileId)
  }

  /** Profiles that connect without asking. */
  savedProfileIds(): string[] {
    return [...new Set([...this.sessionPasswords.keys(), ...(this.sealed.ids() ?? [])])]
  }

  /**
   * Throws with a user-facing reason when `forever` cannot be honoured, or when a password saved
   * earlier cannot be removed for `session` or `never`.
   */
  remember(profileId: string, storage: SshVpnPasswordStorage, password: string): void {
    if (storage === 'never') {
      this.forget(profileId)
      return
    }
    if (storage === 'session') {
      this.deleteSealed(profileId)
      this.sessionPasswords.set(profileId, password)
      return
    }
    const sealed = this.sealed.seal(profileId, password)
    if (sealed === 'no-encryption') {
      throw new Error(
        'This system has no secure password storage. Choose "Until Orca quits" or "Ask every time" instead.'
      )
    }
    if (sealed !== 'sealed') {
      throw new Error(this.sealed.describeProblem(sealed))
    }
    this.sessionPasswords.delete(profileId)
  }

  /**
   * Moves a profile's password to where `storage` keeps it: `never` forgets it, `session` always
   * removes any saved copy, `forever` saves `password` or the one already kept. Throws with a
   * user-facing reason when the saved-password file cannot be changed, so callers can refuse.
   */
  applyStorage(profileId: string, storage: SshVpnPasswordStorage, password: string | null): void {
    if (storage === 'never') {
      this.forget(profileId)
      return
    }
    const kept = password ?? this.get(profileId)
    if (kept !== null) {
      this.remember(profileId, storage, kept)
    } else if (storage === 'session') {
      // Why: an unreadable file hides a saved copy from get(), so removal must not depend on it.
      this.deleteSealed(profileId)
    }
  }

  /** Keeps a password until Orca quits without touching the saved-password file. */
  rememberForSession(profileId: string, password: string): void {
    this.sessionPasswords.set(profileId, password)
  }

  /** Throws when the saved-password file cannot be changed, so a saved password may remain. */
  forget(profileId: string): void {
    this.sessionPasswords.delete(profileId)
    this.deleteSealed(profileId)
  }

  private deleteSealed(profileId: string): void {
    const deleted = this.sealed.delete(profileId)
    if (deleted !== 'deleted') {
      throw new Error(this.sealed.describeProblem(deleted))
    }
  }
}
