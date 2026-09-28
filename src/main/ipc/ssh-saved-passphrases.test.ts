import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { utils } from 'ssh2'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { setSecretStore } from '../../shared/secret-store'

const userData = mkdtempSync(join(tmpdir(), 'orca-ssh-saved-passphrases-ipc-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
}))

const { canRememberSshPassphrase, findSavedSshPassphrase, settleSubmittedSshPassphrase } =
  await import('./ssh-saved-passphrases')

describe('saved SSH passphrases', () => {
  const keyPath = join(userData, 'id_ed25519')

  beforeAll(() => {
    setSecretStore({
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(`sealed:${Buffer.from(text).toString('hex')}`),
      decryptString: (cipher) =>
        Buffer.from(cipher.toString().replace(/^sealed:/, ''), 'hex').toString(),
      describeProtectionGap: () => null
    })
    const key = utils.generateKeyPairSync('ed25519', {
      passphrase: 'right',
      cipher: 'aes256-ctr',
      rounds: 1
    })
    writeFileSync(keyPath, key.private)
  })

  afterAll(() => rmSync(userData, { recursive: true, force: true }))

  it('passes through prompts that unlock no key file', () => {
    expect(canRememberSshPassphrase(null)).toBe(false)
    expect(findSavedSshPassphrase(null)).toBeNull()
    expect(settleSubmittedSshPassphrase(null, 'anything', true)).toEqual({
      status: 'accepted',
      remembered: false
    })
  })

  it('refuses a wrong passphrase and saves nothing', () => {
    expect(settleSubmittedSshPassphrase(keyPath, 'wrong', true)).toEqual({
      status: 'wrong-passphrase'
    })
    expect(findSavedSshPassphrase(keyPath)).toBeNull()
  })

  it('saves a correct passphrase only when asked to', () => {
    expect(canRememberSshPassphrase(keyPath)).toBe(true)
    expect(settleSubmittedSshPassphrase(keyPath, 'right', false)).toEqual({
      status: 'accepted',
      remembered: false
    })
    expect(findSavedSshPassphrase(keyPath)).toBeNull()

    expect(settleSubmittedSshPassphrase(keyPath, 'right', true)).toEqual({
      status: 'accepted',
      remembered: true
    })
    expect(findSavedSshPassphrase(keyPath)).toBe('right')
  })
})
