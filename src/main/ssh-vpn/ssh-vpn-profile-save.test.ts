import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SshVpnProfileDraft } from '../../shared/ssh-vpn-types'
import type { SecretStore } from '../../shared/secret-store'
import { SshVpnPasswordVault } from './ssh-vpn-password-vault'
import { saveProfileWithPassword } from './ssh-vpn-profile-save'
import { SshVpnStore } from './ssh-vpn-store'

const DRAFT: SshVpnProfileDraft = {
  name: 'Office',
  ovpnPath: '/vpn/office.ovpn',
  idleMinutes: 10,
  username: 'omar',
  passwordStorage: 'forever'
}
const DAMAGED = '{"version": 1,'

function secretStore(): SecretStore {
  return {
    isEncryptionAvailable: () => true,
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
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('moves a saved password when the setting changes', () => {
    const saved = saveProfileWithPassword({ store, vault }, null, DRAFT, 'hunter2')

    saveProfileWithPassword({ store, vault }, saved, { ...DRAFT, passwordStorage: 'session' }, null)

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
          null
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
})
