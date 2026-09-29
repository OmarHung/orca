import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { getSecretStore } from '../../shared/secret-store'
import type { SshCredentialSubmitResult } from '../../shared/ssh-saved-passphrase-types'
import { SshSavedPassphraseStore } from '../ssh/ssh-saved-passphrase-store'

let store: SshSavedPassphraseStore | null = null

function getStore(): SshSavedPassphraseStore {
  store ??= new SshSavedPassphraseStore(
    join(app.getPath('userData'), 'ssh-saved-passphrases.json'),
    getSecretStore
  )
  return store
}

// Why: remembering is a convenience; a store failure must fall back to the plain prompt, not fail the connect.
function withStore<T>(fallback: T, read: (store: SshSavedPassphraseStore) => T): T {
  try {
    return read(getStore())
  } catch (error) {
    console.warn(
      `[ssh] Saved passphrases unavailable: ${error instanceof Error ? error.message : String(error)}`
    )
    return fallback
  }
}

export function findSavedSshPassphrase(keyPath: string | null): string | null {
  return keyPath ? withStore(null, (saved) => saved.lookup(keyPath)) : null
}

export function canRememberSshPassphrase(keyPath: string | null): boolean {
  return keyPath !== null && withStore(false, (saved) => saved.canRemember(keyPath))
}

/** Checks a typed passphrase against its key and saves it when asked. */
export function settleSubmittedSshPassphrase(
  keyPath: string | null,
  value: string | null,
  remember: boolean
): SshCredentialSubmitResult {
  const accepted: SshCredentialSubmitResult = { status: 'accepted', remembered: false }
  if (value === null || keyPath === null) {
    return accepted
  }
  return withStore(accepted, (saved) => {
    const check = saved.check(keyPath, value)
    if (check === 'wrong') {
      return { status: 'wrong-passphrase' }
    }
    const remembered = remember && check === 'correct' && saved.remember(keyPath, value)
    return { status: 'accepted', remembered }
  })
}

export function registerSshSavedPassphraseHandlers(): void {
  ipcMain.removeHandler('ssh:listSavedPassphrases')
  ipcMain.handle('ssh:listSavedPassphrases', () => getStore().list())

  ipcMain.removeHandler('ssh:forgetSavedPassphrase')
  ipcMain.handle('ssh:forgetSavedPassphrase', (_event, args: { keyPath?: unknown }) => {
    if (typeof args?.keyPath !== 'string') {
      throw new Error('keyPath must be a string')
    }
    const problem = getStore().forget(args.keyPath)
    if (problem) {
      throw new Error(problem)
    }
  })
}
