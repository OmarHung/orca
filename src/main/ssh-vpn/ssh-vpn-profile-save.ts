import type { SshVpnProfile, SshVpnProfileDraft } from '../../shared/ssh-vpn-types'
import type { SshVpnPasswordVault } from './ssh-vpn-password-vault'
import type { SshVpnStore } from './ssh-vpn-store'

/**
 * Moves the profile's password to where its setting keeps it (see applyStorage) before the
 * setting is saved, so a setting never claims what the saved-password file does not do.
 */
export function saveProfileWithPassword(
  {
    store,
    vault
  }: {
    store: Pick<SshVpnStore, 'saveProfile' | 'deleteProfile'>
    vault: Pick<SshVpnPasswordVault, 'applyStorage' | 'remember' | 'rememberForSession'>
  },
  previous: SshVpnProfile | null,
  draft: SshVpnProfileDraft,
  password: string | null
): SshVpnProfile {
  const storage = draft.passwordStorage ?? 'session'
  if (previous) {
    vault.applyStorage(previous.id, storage, password)
    return store.saveProfile(previous.id, draft)
  }
  // Why: a new profile gets a fresh id, so nothing is saved to move or remove; only a typed password is kept.
  const created = store.saveProfile(undefined, draft)
  if (password === null || storage === 'never') {
    return created
  }
  if (storage === 'session') {
    vault.rememberForSession(created.id, password)
    return created
  }
  try {
    vault.remember(created.id, 'forever', password)
  } catch (error) {
    store.deleteProfile(created.id)
    throw error
  }
  return created
}
