import type { SshVpnCredentials, SshVpnProfile } from '../../shared/ssh-vpn-types'
import type { SshVpnStartOptions } from './ssh-vpn-manager-types'
import type { SshVpnPasswordVault } from './ssh-vpn-password-vault'
import type { SshVpnStore } from './ssh-vpn-store'

/** Asks the user for a VPN login; null when they cancel. */
export type SshVpnLoginPrompt = (request: {
  profile: SshVpnProfile
  hostLabel: string | null
  error: string | null
}) => Promise<SshVpnCredentials | null>

type SshVpnLoginsDeps = {
  vault: Pick<SshVpnPasswordVault, 'get' | 'remember' | 'forget'>
  store: Pick<SshVpnStore, 'saveProfile'>
  prompt?: SshVpnLoginPrompt
  /** The username typed in the prompt was saved to the profile. */
  onProfileChanged?: () => void
}

const REJECTED_MESSAGE = 'The VPN server rejected the last username or password.'

/** Supplies usernames and passwords for profiles that ask for a login (`auth-user-pass`). */
export class SshVpnLogins {
  /** Profiles whose last login the server rejected; their saved password is not offered again. */
  private readonly rejected = new Set<string>()

  constructor(private readonly deps: SshVpnLoginsDeps) {}

  startOptions(
    profile: SshVpnProfile,
    hostLabel: string | null
  ): Pick<SshVpnStartOptions, 'credentials' | 'onLoginRejected'> {
    return {
      credentials: () => this.credentialsFor(profile, hostLabel),
      onLoginRejected: () => {
        this.rejected.add(profile.id)
        this.deps.vault.forget(profile.id)
      }
    }
  }

  private async credentialsFor(
    profile: SshVpnProfile,
    hostLabel: string | null
  ): Promise<SshVpnCredentials | null> {
    const wasRejected = this.rejected.delete(profile.id)
    const saved = this.deps.vault.get(profile.id)
    if (saved && profile.username && !wasRejected) {
      return { username: profile.username, password: saved }
    }
    const answer = await this.deps.prompt?.({
      profile,
      hostLabel,
      error: wasRejected ? REJECTED_MESSAGE : null
    })
    if (!answer) {
      return null
    }
    if (answer.username !== profile.username) {
      this.deps.store.saveProfile(profile.id, { ...profile, username: answer.username })
      this.deps.onProfileChanged?.()
    }
    try {
      this.deps.vault.remember(profile.id, profile.passwordStorage ?? 'session', answer.password)
    } catch {
      // Why: no keychain must not block connecting; keep it until Orca quits instead.
      this.deps.vault.remember(profile.id, 'session', answer.password)
    }
    return answer
  }
}
