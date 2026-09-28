import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { utils } from 'ssh2'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import { normalizeSshKeyPath, SshSavedPassphraseStore } from './ssh-saved-passphrase-store'

function fakeSecretStore(options: { available?: boolean; gap?: string | null } = {}): SecretStore {
  const available = options.available ?? true
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`sealed:${Buffer.from(text).toString('hex')}`),
    decryptString: (cipher) =>
      Buffer.from(cipher.toString().replace(/^sealed:/, ''), 'hex').toString(),
    describeProtectionGap: () => options.gap ?? null
  }
}

function writeKey(path: string, passphrase?: string): void {
  // Why rounds 1: the default bcrypt cost makes every parse take ~200ms.
  const key = passphrase
    ? utils.generateKeyPairSync('ed25519', { passphrase, cipher: 'aes256-ctr', rounds: 1 })
    : utils.generateKeyPairSync('ed25519')
  writeFileSync(path, key.private)
}

describe('normalizeSshKeyPath', () => {
  it('expands the home directory and rejects prompts that name no file', () => {
    expect(normalizeSshKeyPath('~/.ssh/id_ed25519')).toBe(join(homedir(), '.ssh', 'id_ed25519'))
    expect(normalizeSshKeyPath('(unknown)')).toBeNull()
    expect(normalizeSshKeyPath('')).toBeNull()
  })
})

describe('SshSavedPassphraseStore', () => {
  let dir: string
  let vaultPath: string
  let keyPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-ssh-passphrases-'))
    vaultPath = join(dir, 'ssh-saved-passphrases.json')
    keyPath = join(dir, 'id_ed25519')
    writeKey(keyPath, 'right')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('seals a remembered passphrase and returns it after a restart', () => {
    const store = new SshSavedPassphraseStore(vaultPath, () => fakeSecretStore())
    expect(store.remember(keyPath, 'right')).toBe(true)
    expect(readFileSync(vaultPath, 'utf8')).not.toContain('right')

    const restarted = new SshSavedPassphraseStore(vaultPath, () => fakeSecretStore())
    expect(restarted.lookup(keyPath)).toBe('right')
    expect(restarted.list()).toEqual([keyPath])
  })

  it('tells a wrong passphrase from a correct one', () => {
    const store = new SshSavedPassphraseStore(vaultPath, () => fakeSecretStore())
    expect(store.check(keyPath, 'wrong')).toBe('wrong')
    expect(store.check(keyPath, 'right')).toBe('correct')
    expect(store.check(join(dir, 'missing'), 'right')).toBe('unverifiable')
  })

  it('drops a saved passphrase once the key it unlocked is replaced', () => {
    const store = new SshSavedPassphraseStore(vaultPath, () => fakeSecretStore())
    store.remember(keyPath, 'right')
    expect(store.lookup(keyPath)).toBe('right')

    writeKey(keyPath, 'rotated')

    expect(store.lookup(keyPath)).toBeNull()
    expect(store.list()).toEqual([])
  })

  it('keeps a saved passphrase while its key file is unavailable', () => {
    const store = new SshSavedPassphraseStore(vaultPath, () => fakeSecretStore())
    store.remember(keyPath, 'right')
    rmSync(keyPath)

    expect(store.lookup(keyPath)).toBeNull()
    expect(store.list()).toEqual([keyPath])
  })

  it('only offers to remember encrypted keys on a keychain that really seals', () => {
    const plainKeyPath = join(dir, 'id_plain')
    writeKey(plainKeyPath)
    const sealing = new SshSavedPassphraseStore(vaultPath, () => fakeSecretStore())
    expect(sealing.canRemember(keyPath)).toBe(true)
    expect(sealing.canRemember(plainKeyPath)).toBe(false)
    expect(sealing.canRemember(join(dir, 'missing'))).toBe(false)

    const noKeychain = new SshSavedPassphraseStore(vaultPath, () =>
      fakeSecretStore({ available: false })
    )
    expect(noKeychain.canRemember(keyPath)).toBe(false)
    expect(noKeychain.remember(keyPath, 'right')).toBe(false)

    const obfuscating = new SshSavedPassphraseStore(vaultPath, () =>
      fakeSecretStore({ gap: 'basic_text' })
    )
    expect(obfuscating.canRemember(keyPath)).toBe(false)
  })

  it('forgets a saved passphrase', () => {
    const store = new SshSavedPassphraseStore(vaultPath, () => fakeSecretStore())
    store.remember(keyPath, 'right')
    expect(store.forget(keyPath)).toBe(true)
    expect(store.lookup(keyPath)).toBeNull()
    expect(store.list()).toEqual([])
  })
})
