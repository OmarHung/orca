import type { SshVpnPasswordStorage } from '../../shared/ssh-vpn-types'
import type { SecretStore } from '../../shared/secret-store'
import { KeptPasswords } from '../kept-passwords'

const NO_KEYCHAIN_MESSAGE =
  'This system has no secure password storage. Choose "Until Orca quits" or "Ask every time" instead.'

function throwIfProblem(problem: string | null): void {
  if (problem !== null) {
    throw new Error(problem)
  }
}

/**
 * VPN login passwords, by profile id (see KeptPasswords). Changes throw with a user-facing reason
 * when they cannot be honoured, having changed nothing on disk.
 */
export class SshVpnPasswordVault {
  private readonly passwords: KeptPasswords

  constructor(filePath: string, secretStore: () => SecretStore) {
    this.passwords = new KeptPasswords(filePath, secretStore, NO_KEYCHAIN_MESSAGE)
  }

  canStorePasswords(): boolean {
    return this.passwords.canSeal()
  }

  get(profileId: string): string | null {
    return this.passwords.get(profileId)
  }

  /** Profiles that connect without asking. */
  savedProfileIds(): string[] {
    return this.passwords.ids()
  }

  remember(profileId: string, storage: SshVpnPasswordStorage, password: string): void {
    throwIfProblem(this.passwords.remember(profileId, storage, password))
  }

  /** Keeps a password until Orca quits without touching the saved-password file. */
  rememberForSession(profileId: string, password: string): void {
    this.passwords.rememberForSession(profileId, password)
  }

  forget(profileId: string): void {
    throwIfProblem(this.passwords.forget(profileId))
  }

  /** Before a setting change is saved; `undefined` keeps the password already kept. */
  release(profileId: string, storage: SshVpnPasswordStorage, password: string | undefined): void {
    throwIfProblem(this.passwords.release(profileId, storage, password))
  }

  /** After a setting change is saved. */
  keep(profileId: string, storage: SshVpnPasswordStorage, password: string | undefined): void {
    throwIfProblem(this.passwords.keep(profileId, storage, password))
  }
}
