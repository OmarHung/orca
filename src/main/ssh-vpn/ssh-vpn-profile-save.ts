import type { SshVpnProfile, SshVpnProfileDraft } from '../../shared/ssh-vpn-types'
import type { SshVpnPasswordVault } from './ssh-vpn-password-vault'
import type { SshVpnStore } from './ssh-vpn-store'

/**
 * Saves a profile and moves its password to where the setting keeps it: removals before the
 * setting is saved, sealing after it (undone on failure), so a failed step never leaves a
 * setting claiming what the saved-password file does not do, or a password it did not ask for.
 */
export function saveProfileWithPassword(
  {
    store,
    vault
  }: {
    store: Pick<SshVpnStore, 'saveProfile' | 'deleteProfile'>
    vault: Pick<SshVpnPasswordVault, 'release' | 'keep' | 'remember' | 'rememberForSession'>
  },
  previous: SshVpnProfile | null,
  draft: SshVpnProfileDraft,
  password: string | undefined
): SshVpnProfile {
  const storage = draft.passwordStorage ?? 'session'
  if (previous) {
    vault.release(previous.id, storage, password)
    const saved = store.saveProfile(previous.id, draft)
    try {
      vault.keep(previous.id, storage, password)
    } catch (error) {
      store.saveProfile(previous.id, previous)
      throw error
    }
    return saved
  }
  // Why: a new profile gets a fresh id, so nothing is saved to move or remove; only a typed password is kept.
  const created = store.saveProfile(undefined, draft)
  if (password === undefined || storage === 'never') {
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
