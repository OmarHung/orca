import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../shared/secret-store'
import { KeptPasswords } from './kept-passwords'

const NO_ENCRYPTION = 'no encryption'

describe('KeptPasswords', () => {
  let dir: string
  let filePath: string
  let keychainOpen: boolean
  let passwords: KeptPasswords

  const secretStore = (): SecretStore => ({
    isEncryptionAvailable: () => keychainOpen,
    encryptString: (plain) => Buffer.from(`sealed:${plain}`),
    decryptString: (cipher) => cipher.toString().replace(/^sealed:/, ''),
    describeProtectionGap: () => null
  })
  const reopened = (): KeptPasswords => new KeptPasswords(filePath, secretStore, NO_ENCRYPTION)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-kept-passwords-'))
    filePath = join(dir, 'passwords.json')
    keychainOpen = true
    passwords = reopened()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('moves a saved password into memory for "session" and back to disk for "forever"', () => {
    expect(passwords.remember('a', 'forever', 'hunter2')).toBeNull()

    expect(passwords.release('a', 'session', undefined).ok).toBe(true)
    expect(passwords.get('a')).toBe('hunter2')
    expect(reopened().get('a')).toBeNull()

    expect(passwords.release('a', 'forever', undefined).ok).toBe(true)
    expect(passwords.keep('a', 'forever', undefined)).toBeNull()
    expect(reopened().get('a')).toBe('hunter2')
  })

  it('refuses to move a saved password the keychain cannot open now, changing nothing', () => {
    passwords.remember('a', 'forever', 'hunter2')
    const onDisk = readFileSync(filePath, 'utf8')
    keychainOpen = false

    expect(passwords.release('a', 'session', undefined)).toMatchObject({
      ok: false,
      problem: expect.stringContaining('locked or unavailable')
    })

    expect(readFileSync(filePath, 'utf8')).toBe(onDisk)
    keychainOpen = true
    expect(reopened().get('a')).toBe('hunter2')
  })

  it('leaves a saved password untouched when a "forever" change brings nothing new', () => {
    passwords.remember('a', 'forever', 'hunter2')
    const onDisk = readFileSync(filePath, 'utf8')
    keychainOpen = false

    expect(passwords.release('a', 'forever', undefined).ok).toBe(true)
    expect(passwords.keep('a', 'forever', undefined)).toBeNull()

    expect(readFileSync(filePath, 'utf8')).toBe(onDisk)
  })

  it('clears for null or "never", and replaces with a new password', () => {
    passwords.remember('a', 'forever', 'old')
    passwords.remember('b', 'forever', 'old')

    expect(passwords.release('a', 'forever', null).ok).toBe(true)
    expect(passwords.release('b', 'forever', 'new').ok).toBe(true)
    expect(passwords.keep('b', 'forever', 'new')).toBeNull()
    expect(passwords.release('b', 'never', undefined).ok).toBe(true)

    expect(passwords.ids()).toEqual([])
    expect(reopened().get('a')).toBeNull()
  })

  it.each(['session', 'never'] as const)(
    'puts a released "forever" password back with undo, even with the keychain locked (%s)',
    (storage) => {
      passwords.remember('a', 'forever', 'hunter2')
      passwords.rememberForSession('b', 'other')
      const released = passwords.release('a', storage, undefined)
      if (!released.ok) {
        throw new Error(released.problem)
      }
      keychainOpen = false

      expect(released.undo()).toBeNull()

      keychainOpen = true
      expect(reopened().get('a')).toBe('hunter2')
      expect(passwords.get('b')).toBe('other')
    }
  )

  it('reports when undo cannot put the password back', () => {
    passwords.remember('a', 'forever', 'hunter2')
    const released = passwords.release('a', 'never', undefined)
    if (!released.ok) {
      throw new Error(released.problem)
    }
    writeFileSync(filePath, '{"version": 1,')

    expect(released.undo()).toContain(filePath)
  })

  it('keeps nothing in memory for "session" when the saved copy cannot be removed', () => {
    passwords.remember('a', 'forever', 'old')
    writeFileSync(filePath, '{"version": 1,')

    expect(passwords.remember('a', 'session', 'new')).toContain(filePath)

    expect(passwords.get('a')).toBeNull()
  })

  it('reports why sealing failed and keeps the in-memory copy', () => {
    passwords.rememberForSession('a', 'typed')
    keychainOpen = false

    expect(passwords.keep('a', 'forever', undefined)).toBe(NO_ENCRYPTION)

    expect(passwords.get('a')).toBe('typed')
  })
})
