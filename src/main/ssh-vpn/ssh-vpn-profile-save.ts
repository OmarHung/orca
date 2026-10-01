import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  SshVpnOvpnInspection,
  SshVpnPasswordStorage,
  SshVpnProfile,
  SshVpnProfileDraft
} from '../../shared/ssh-vpn-types'
import { rollBack } from '../kept-passwords'
import type { SshVpnPasswordVault } from './ssh-vpn-password-vault'
import type { SshVpnStore } from './ssh-vpn-store'

type SaveDeps = {
  store: Pick<SshVpnStore, 'getProfile' | 'saveProfile' | 'deleteProfile'>
  vault: Pick<SshVpnPasswordVault, 'release' | 'keep' | 'remember' | 'rememberForSession'>
}

/** A borrowed container has no password of Orca's, so switching to one forgets the old one. */
function storageOf(profile: SshVpnProfileDraft): SshVpnPasswordStorage {
  return profile.kind === 'container' ? 'never' : (profile.passwordStorage ?? 'session')
}

/**
 * Saves a profile and moves its password to where the setting keeps it: removals before the
 * setting is saved, sealing after it. Any failure takes the change back, so a failed save never
 * loses a password or keeps one the saved setting did not ask for.
 */
export function saveProfileWithPassword(
  deps: SaveDeps,
  previous: SshVpnProfile | null,
  draft: SshVpnProfileDraft,
  password: string | undefined
): SshVpnProfile {
  return previous
    ? saveExistingProfile(deps, previous, draft, password)
    : saveNewProfile(deps, draft, password)
}

function saveExistingProfile(
  { store, vault }: SaveDeps,
  previous: SshVpnProfile,
  draft: SshVpnProfileDraft,
  password: string | undefined
): SshVpnProfile {
  const storage = storageOf(draft)
  const undo = vault.release(previous.id, storage, password)
  try {
    const saved = store.saveProfile(previous.id, draft)
    vault.keep(previous.id, storage, password)
    return saved
  } catch (error) {
    throw rollBack(error, undo, {
      // Why only when changed: a write that failed before replacing the file left nothing to revert.
      revert: () => {
        if (!isDeepStrictEqual(store.getProfile(previous.id), previous)) {
          store.saveProfile(previous.id, previous)
        }
      },
      keepsPreviousPasswords: () => {
        const saved = store.getProfile(previous.id)
        return saved !== null && storageOf(saved) === storageOf(previous)
      }
    })
  }
}

/** A new profile has nothing saved to move or remove, so only a typed password is kept. */
function saveNewProfile(
  { store, vault }: SaveDeps,
  draft: SshVpnProfileDraft,
  password: string | undefined
): SshVpnProfile {
  const storage = storageOf(draft)
  // Why chosen here: a write can fail after it replaced the file, and only the id finds it then.
  const id = randomUUID()
  try {
    const created = store.saveProfile(id, draft)
    if (password !== undefined && storage === 'session') {
      vault.rememberForSession(id, password)
    }
    if (password !== undefined && storage === 'forever') {
      vault.remember(id, 'forever', password)
    }
    return created
  } catch (error) {
    // Why nothing to undo: a failed remember already put the password file back.
    throw rollBack(error, () => null, {
      revert: () => store.deleteProfile(id),
      keepsPreviousPasswords: () => true
    })
  }
}

type SaveProfileDeps = SaveDeps & {
  inspectOvpn: (ovpnPath: string) => Promise<SshVpnOvpnInspection>
  /** Throws why connections through the container would not stay on its VPN. */
  inspectContainer: (containerName: string) => Promise<void>
}

/** What the Settings form's save runs: check the profile, then save it with its password. */
export async function saveSshVpnProfile(
  deps: SaveProfileDeps,
  request: { id?: string; draft: SshVpnProfileDraft; password?: string }
): Promise<{ previous: SshVpnProfile | null; saved: SshVpnProfile }> {
  const { draft } = request
  // Why before saving: a profile that cannot connect should fail here, not on first use.
  if (draft.kind === 'container') {
    await deps.inspectContainer(draft.containerName)
  } else {
    const { needsCredentials } = await deps.inspectOvpn(draft.ovpnPath)
    if (needsCredentials && !draft.username) {
      throw new Error('This profile asks for a username and password. Enter the username.')
    }
  }
  const previous = request.id ? deps.store.getProfile(request.id) : null
  const password = draft.kind === 'container' ? undefined : request.password
  // Why no keychain check here: only sealing a new or in-memory password needs one, and that
  // step reports it, so renaming a "Forever" profile still works while the keychain is locked.
  return { previous, saved: saveProfileWithPassword(deps, previous, draft, password) }
}
