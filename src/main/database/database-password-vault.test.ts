import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import { DatabasePasswordVault } from './database-password-vault'

function fakeSecretStore(available = true): SecretStore {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`sealed:${text}`),
    decryptString: (cipher) => cipher.toString().replace(/^sealed:/, ''),
    describeProtectionGap: () => (available ? null : 'no keyring')
  }
}

describe('DatabasePasswordVault', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-db-vault-'))
    filePath = join(dir, 'passwords.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('seals "forever" passwords and never writes plaintext', () => {
    const vault = new DatabasePasswordVault(filePath, () => fakeSecretStore())
    expect(vault.remember('conn-1', 'forever', 'hunter2').ok).toBe(true)
    const onDisk = readFileSync(filePath, 'utf8')
    expect(onDisk).not.toContain('hunter2')
    const fresh = new DatabasePasswordVault(filePath, () => fakeSecretStore())
    expect(fresh.get('conn-1')).toBe('hunter2')
    expect(fresh.has('conn-1')).toBe(true)
  })

  it('keeps "session" passwords in memory only', () => {
    const vault = new DatabasePasswordVault(filePath, () => fakeSecretStore())
    vault.remember('conn-1', 'forever', 'old')
    vault.remember('conn-1', 'session', 'new')
    expect(vault.get('conn-1')).toBe('new')
    expect(new DatabasePasswordVault(filePath, () => fakeSecretStore()).get('conn-1')).toBeNull()
  })

  it('forgets everything for "never"', () => {
    const vault = new DatabasePasswordVault(filePath, () => fakeSecretStore())
    vault.remember('conn-1', 'forever', 'secret')
    vault.remember('conn-1', 'never', 'secret')
    expect(vault.has('conn-1')).toBe(false)
  })

  it('keeps no "until quit" password when the saved copy cannot be removed', () => {
    const vault = new DatabasePasswordVault(filePath, () => fakeSecretStore())
    vault.remember('conn-1', 'forever', 'old')
    writeFileSync(filePath, '{"version": 1,')

    expect(vault.remember('conn-1', 'session', 'new').ok).toBe(false)
    expect(vault.get('conn-1')).toBeNull()
  })

  it('refuses to store "forever" without OS encryption', () => {
    const vault = new DatabasePasswordVault(filePath, () => fakeSecretStore(false))
    const result = vault.remember('conn-1', 'forever', 'secret')
    expect(result.ok).toBe(false)
    expect(vault.encryptionStatus()).toEqual({
      canStorePasswords: false,
      protectionGap: 'no keyring'
    })
  })
})
