import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshVpnProfileDraft } from '../../shared/ssh-vpn-types'
import type { SecretStore } from '../../shared/secret-store'
import { SshVpnPasswordVault } from './ssh-vpn-password-vault'
import { saveProfileWithPassword, saveSshVpnProfile } from './ssh-vpn-profile-save'
import { SshVpnStore } from './ssh-vpn-store'

const DRAFT: SshVpnProfileDraft = {
  name: 'Office',
  ovpnPath: '/vpn/office.ovpn',
  idleMinutes: 10,
  username: 'omar',
  passwordStorage: 'forever'
}
const DAMAGED = '{"version": 1,'

let keychainOpen = true

function secretStore(): SecretStore {
  return {
    isEncryptionAvailable: () => keychainOpen,
    encryptString: (plain) => Buffer.from(`sealed:${plain}`),
    decryptString: (cipher) => cipher.toString().replace(/^sealed:/, ''),
    describeProtectionGap: () => null
  }
}

describe('saveProfileWithPassword', () => {
  let dir: string
  let passwordsPath: string
  let store: SshVpnStore
  let vault: SshVpnPasswordVault

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-ssh-vpn-profile-save-'))
    passwordsPath = join(dir, 'passwords.json')
    store = new SshVpnStore(join(dir, 'ssh-vpn.json'))
    vault = new SshVpnPasswordVault(passwordsPath, secretStore)
    keychainOpen = true
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('moves a saved password when the setting changes', () => {
    const saved = saveProfileWithPassword({ store, vault }, null, DRAFT, 'hunter2')

    saveProfileWithPassword(
      { store, vault },
      saved,
      { ...DRAFT, passwordStorage: 'session' },
      undefined
    )

    expect(vault.get(saved.id)).toBe('hunter2')
    expect(new SshVpnPasswordVault(passwordsPath, secretStore).get(saved.id)).toBeNull()
  })

  it.each(['never', 'session'] as const)(
    'keeps the old setting when switching to %s cannot remove the saved password',
    (storage) => {
      const saved = saveProfileWithPassword({ store, vault }, null, DRAFT, 'hunter2')
      writeFileSync(passwordsPath, DAMAGED)

      expect(() =>
        saveProfileWithPassword(
          { store, vault },
          saved,
          { ...DRAFT, passwordStorage: storage },
          undefined
        )
      ).toThrow(passwordsPath)

      expect(store.getProfile(saved.id)?.passwordStorage).toBe('forever')
      expect(readFileSync(passwordsPath, 'utf8')).toBe(DAMAGED)
    }
  )

  it('does not create a profile whose password cannot be saved', () => {
    writeFileSync(passwordsPath, DAMAGED)

    expect(() => saveProfileWithPassword({ store, vault }, null, DRAFT, 'hunter2')).toThrow(
      passwordsPath
    )

    expect(store.listProfiles()).toEqual([])
  })

  it('creates a new profile that keeps nothing on disk without touching the file', () => {
    writeFileSync(passwordsPath, DAMAGED)

    const session = saveProfileWithPassword(
      { store, vault },
      null,
      { ...DRAFT, passwordStorage: 'session' },
      'typed'
    )
    const never = saveProfileWithPassword(
      { store, vault },
      null,
      { ...DRAFT, passwordStorage: 'never' },
      'typed'
    )

    expect(vault.get(session.id)).toBe('typed')
    expect(vault.get(never.id)).toBeNull()
    expect(store.listProfiles()).toHaveLength(2)
    expect(readFileSync(passwordsPath, 'utf8')).toBe(DAMAGED)
  })

  it('refuses to move a saved password it cannot read while the keychain is locked', () => {
    const saved = saveProfileWithPassword({ store, vault }, null, DRAFT, 'hunter2')
    const onDisk = readFileSync(passwordsPath, 'utf8')
    keychainOpen = false

    expect(() =>
      saveProfileWithPassword(
        { store, vault },
        saved,
        { ...DRAFT, passwordStorage: 'session' },
        undefined
      )
    ).toThrow('keychain is locked or unavailable')

    expect(store.getProfile(saved.id)?.passwordStorage).toBe('forever')
    expect(readFileSync(passwordsPath, 'utf8')).toBe(onDisk)
    keychainOpen = true
    expect(vault.get(saved.id)).toBe('hunter2')
  })

  it('keeps a saved password untouched when only the name changes while the keychain is locked', () => {
    const saved = saveProfileWithPassword({ store, vault }, null, DRAFT, 'hunter2')
    keychainOpen = false

    saveProfileWithPassword({ store, vault }, saved, { ...DRAFT, name: 'Renamed' }, undefined)

    keychainOpen = true
    expect(store.getProfile(saved.id)?.name).toBe('Renamed')
    expect(vault.get(saved.id)).toBe('hunter2')
  })

  it('seals nothing when saving the setting fails', () => {
    const saved = saveProfileWithPassword(
      { store, vault },
      null,
      { ...DRAFT, passwordStorage: 'never' },
      undefined
    )
    const failing = {
      saveProfile: () => {
        throw new Error('disk full')
      },
      deleteProfile: store.deleteProfile.bind(store)
    }

    expect(() =>
      saveProfileWithPassword({ store: failing, vault }, saved, DRAFT, 'hunter2')
    ).toThrow('disk full')

    expect(new SshVpnPasswordVault(passwordsPath, secretStore).get(saved.id)).toBeNull()
  })

  it.each(['session', 'never'] as const)(
    'keeps the saved password when switching to %s fails to save the setting',
    (storage) => {
      const saved = saveProfileWithPassword({ store, vault }, null, DRAFT, 'hunter2')
      const failing = {
        saveProfile: () => {
          throw new Error('disk full')
        },
        deleteProfile: store.deleteProfile.bind(store)
      }

      expect(() =>
        saveProfileWithPassword(
          { store: failing, vault },
          saved,
          { ...DRAFT, passwordStorage: storage },
          undefined
        )
      ).toThrow('disk full')

      expect(store.getProfile(saved.id)?.passwordStorage).toBe('forever')
      expect(new SshVpnPasswordVault(passwordsPath, secretStore).get(saved.id)).toBe('hunter2')
    }
  )

  it('puts the old setting back when sealing after it fails', () => {
    const saved = saveProfileWithPassword(
      { store, vault },
      null,
      { ...DRAFT, passwordStorage: 'never' },
      undefined
    )
    writeFileSync(passwordsPath, DAMAGED)

    expect(() => saveProfileWithPassword({ store, vault }, saved, DRAFT, 'hunter2')).toThrow(
      passwordsPath
    )

    expect(store.getProfile(saved.id)?.passwordStorage).toBe('never')
    expect(readFileSync(passwordsPath, 'utf8')).toBe(DAMAGED)
  })

  it('puts the password back even when restoring the old setting fails', () => {
    const saved = saveProfileWithPassword(
      { store, vault },
      null,
      { ...DRAFT, passwordStorage: 'never' },
      undefined
    )
    const undo = vi.fn<() => string | null>(() => null)
    const failingVault = {
      release: () => undo,
      keep: () => {
        throw new Error('fsync failed')
      },
      remember: vault.remember.bind(vault),
      rememberForSession: vault.rememberForSession.bind(vault)
    }
    let saves = 0
    const flaky = {
      saveProfile: (id: string | undefined, draft: SshVpnProfileDraft) => {
        saves += 1
        if (saves > 1) {
          throw new Error('settings locked')
        }
        return store.saveProfile(id, draft)
      },
      deleteProfile: store.deleteProfile.bind(store)
    }

    expect(() =>
      saveProfileWithPassword({ store: flaky, vault: failingVault }, saved, DRAFT, 'hunter2')
    ).toThrow(/fsync failed.*settings locked/)

    expect(undo).toHaveBeenCalledOnce()
  })

  describe('saveSshVpnProfile (the Settings form save)', () => {
    const inspectOvpn = async (): Promise<{ needsCredentials: boolean }> => ({
      needsCredentials: true
    })

    it('renames a "Forever" profile while the keychain is locked, keeping its password', async () => {
      const saved = saveProfileWithPassword({ store, vault }, null, DRAFT, 'hunter2')
      keychainOpen = false

      await saveSshVpnProfile(
        { store, vault, inspectOvpn },
        { id: saved.id, draft: { ...DRAFT, name: 'Renamed' } }
      )

      keychainOpen = true
      expect(store.getProfile(saved.id)?.name).toBe('Renamed')
      expect(vault.get(saved.id)).toBe('hunter2')
    })

    it('refuses a new "Forever" password while the keychain is locked, changing nothing', async () => {
      const saved = saveProfileWithPassword({ store, vault }, null, DRAFT, 'hunter2')
      keychainOpen = false

      await expect(
        saveSshVpnProfile(
          { store, vault, inspectOvpn },
          { id: saved.id, draft: { ...DRAFT, name: 'Renamed' }, password: 'new' }
        )
      ).rejects.toThrow('no secure password storage')

      keychainOpen = true
      expect(store.getProfile(saved.id)?.name).toBe('Office')
      expect(vault.get(saved.id)).toBe('hunter2')
    })

    it('checks the username before changing anything', async () => {
      await expect(
        saveSshVpnProfile(
          { store, vault, inspectOvpn },
          { draft: { ...DRAFT, username: undefined }, password: 'typed' }
        )
      ).rejects.toThrow('Enter the username')

      expect(store.listProfiles()).toEqual([])
    })
  })
})
