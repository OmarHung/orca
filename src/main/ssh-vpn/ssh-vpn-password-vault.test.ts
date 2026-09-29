import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import { SshVpnPasswordVault } from './ssh-vpn-password-vault'

function fakeSecretStore(available: boolean): SecretStore {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`sealed:${plain}`),
    decryptString: (cipher) => cipher.toString().replace(/^sealed:/, ''),
    describeProtectionGap: () => null
  }
}

describe('SshVpnPasswordVault', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-ssh-vpn-vault-'))
    file = join(dir, 'ssh-vpn-passwords.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('seals "forever" passwords, never writing plaintext, and keeps them across instances', () => {
    const vault = new SshVpnPasswordVault(file, () => fakeSecretStore(true))

    vault.remember('p1', 'forever', 'hunter2')

    expect(readFileSync(file, 'utf8')).not.toContain('hunter2')
    expect(new SshVpnPasswordVault(file, () => fakeSecretStore(true)).get('p1')).toBe('hunter2')
    expect(vault.savedProfileIds()).toEqual(['p1'])
  })

  it('keeps "session" passwords in memory only, and "never" forgets', () => {
    const vault = new SshVpnPasswordVault(file, () => fakeSecretStore(true))

    vault.remember('p1', 'session', 'in-memory')
    expect(vault.get('p1')).toBe('in-memory')
    expect(new SshVpnPasswordVault(file, () => fakeSecretStore(true)).get('p1')).toBeNull()

    vault.remember('p1', 'never', 'ignored')
    expect(vault.get('p1')).toBeNull()
    expect(vault.savedProfileIds()).toEqual([])
  })

  it('refuses "forever" without a keychain', () => {
    const vault = new SshVpnPasswordVault(file, () => fakeSecretStore(false))

    expect(vault.canStorePasswords()).toBe(false)
    expect(() => vault.remember('p1', 'forever', 'x')).toThrow(/no secure password storage/)
  })
})
