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

  /** Throws with a user-facing reason when `forever` cannot be honoured. */
  remember(profileId: string, storage: SshVpnPasswordStorage, password: string): void {
    if (storage === 'never') {
      this.forget(profileId)
      return
    }
    if (storage === 'session') {
      this.sealed.delete(profileId)
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

  forget(profileId: string): void {
    this.sessionPasswords.delete(profileId)
    this.sealed.delete(profileId)
  }
}
