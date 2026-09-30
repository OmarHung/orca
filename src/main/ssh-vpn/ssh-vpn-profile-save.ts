import type { SshVpnProfile, SshVpnProfileDraft } from '../../shared/ssh-vpn-types'
import { afterUndo } from '../kept-passwords'
import type { SshVpnPasswordVault } from './ssh-vpn-password-vault'
import type { SshVpnStore } from './ssh-vpn-store'

/**
 * Saves a profile and moves its password to where the setting keeps it: removals before the
 * setting is saved, sealing after it. Any failure puts the setting and the passwords back, so a
 * failed save never loses a password or keeps one the setting did not ask for.
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
    const undo = vault.release(previous.id, storage, password)
    let saved: SshVpnProfile
    try {
      saved = store.saveProfile(previous.id, draft)
    } catch (error) {
      throw afterUndo(error, undo())
    }
    try {
      vault.keep(previous.id, storage, password)
    } catch (error) {
      store.saveProfile(previous.id, previous)
      throw afterUndo(error, undo())
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
