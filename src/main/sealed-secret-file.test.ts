import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../shared/secret-store'
import { SealedSecretFile } from './sealed-secret-file'

function fakeSecretStore(): SecretStore {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`sealed:${text}`),
    decryptString: (cipher) => cipher.toString().replace(/^sealed:/, ''),
    describeProtectionGap: () => null
  }
}

function validFile(ciphertexts: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, format: 'orca-secret-store-v1', ciphertexts })
}

describe('SealedSecretFile', () => {
  let dir: string
  let filePath: string
  let file: SealedSecretFile

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-sealed-secret-'))
    filePath = join(dir, 'secrets.json')
    file = new SealedSecretFile(filePath, fakeSecretStore)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates the file on the first secret and keeps the others on later ones', () => {
    expect(file.seal('a', 'first')).toBe('sealed')
    expect(file.seal('b', 'second')).toBe('sealed')

    expect(file.get('a')).toBe('first')
    expect(file.ids()).toEqual(['a', 'b'])
    expect(file.delete('a')).toBe('deleted')
    expect(file.ids()).toEqual(['b'])
  })

  it.each([
    ['is not JSON', '{"version": 1, "ciphertexts": {'],
    ['is not an object', '[]'],
    ['has no ciphertexts', JSON.stringify({ version: 1, format: 'orca-secret-store-v1' })],
    ['has an unknown format', JSON.stringify({ version: 1, format: 'other', ciphertexts: {} })],
    ['holds a non-string entry', validFile({ kept: 'c2VhbGVkOng=', broken: 42 })]
  ])('never overwrites a file that %s', (_case, contents) => {
    writeFileSync(filePath, contents)

    expect(file.seal('new', 'secret')).toBe('damaged')
    expect(file.delete('kept')).toBe('damaged')
    expect(file.ids()).toBeNull()
    expect(file.get('kept')).toBeNull()
    expect(readFileSync(filePath, 'utf8')).toBe(contents)
  })

  it('never overwrites a file written by a newer Orca', () => {
    const contents = JSON.stringify({ version: 2, format: 'orca-secret-store-v2', entries: {} })
    writeFileSync(filePath, contents)

    expect(file.seal('new', 'secret')).toBe('newer-format')
    expect(file.delete('new')).toBe('newer-format')
    expect(readFileSync(filePath, 'utf8')).toBe(contents)
  })

  it('never overwrites a path it cannot read', () => {
    mkdirSync(filePath)

    expect(file.seal('new', 'secret')).toBe('unreadable')
    expect(file.has('new')).toBe(false)
  })

  it('tells a missing secret apart from one it cannot open now', () => {
    let keychainOpen = true
    let decryptFails = false
    const lookups = new SealedSecretFile(filePath, () => ({
      ...fakeSecretStore(),
      isEncryptionAvailable: () => keychainOpen,
      decryptString: (cipher) => {
        if (decryptFails) {
          throw new Error('keychain reset')
        }
        return cipher.toString().replace(/^sealed:/, '')
      }
    }))
    lookups.seal('a', 'secret')

    expect(lookups.lookup('missing')).toEqual({ state: 'absent' })
    expect(lookups.lookup('a')).toEqual({ state: 'available', secret: 'secret' })
    keychainOpen = false
    expect(lookups.lookup('a')).toEqual({ state: 'unavailable' })
    keychainOpen = true
    decryptFails = true
    expect(lookups.lookup('a')).toEqual({ state: 'unavailable' })
    writeFileSync(filePath, '[]')
    expect(lookups.lookup('a')).toEqual({ state: 'problem', problem: 'damaged' })
  })

  it('names the file in every problem so the user can find it', () => {
    for (const problem of ['unreadable', 'damaged', 'newer-format'] as const) {
      expect(file.describeProblem(problem)).toContain(filePath)
    }
  })
})
