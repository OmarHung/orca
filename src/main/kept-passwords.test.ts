import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SecureFile from '../shared/secure-file'
import type { SecretStore } from '../shared/secret-store'
import { KeptPasswords, type Released } from './kept-passwords'

const NO_ENCRYPTION = 'no encryption'
const DAMAGED = '{"version": 1,'

const writes = vi.hoisted(() => ({ failAfterReplacing: 0 }))

vi.mock('../shared/secure-file', async (importOriginal) => {
  const actual = await importOriginal<typeof SecureFile>()
  return {
    ...actual,
    // Why: a durable write can replace the file and only then fail on its ACL or directory fsync.
    writeDurableSecureJsonFile: (targetPath: string, value: unknown): boolean => {
      const written = actual.writeDurableSecureJsonFile(targetPath, value)
      if (writes.failAfterReplacing > 0) {
        writes.failAfterReplacing -= 1
        throw new Error('fsync failed')
      }
      return written
    }
  }
})

function undoOf(released: Released): () => string | null {
  if (!released.ok) {
    throw new Error(released.problem)
  }
  return released.undo
}

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
    writes.failAfterReplacing = 0
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
      const undo = undoOf(passwords.release('a', storage, undefined))
      keychainOpen = false

      expect(undo()).toBeNull()

      keychainOpen = true
      expect(reopened().get('a')).toBe('hunter2')
      expect(passwords.get('b')).toBe('other')
    }
  )

  it('reports when undo cannot put the password back', () => {
    passwords.remember('a', 'forever', 'hunter2')
    const undo = undoOf(passwords.release('a', 'never', undefined))
    writeFileSync(filePath, DAMAGED)

    expect(undo()).toContain(filePath)
  })

  it('keeps nothing in memory for "session" when the saved copy cannot be removed', () => {
    passwords.remember('a', 'forever', 'old')
    writeFileSync(filePath, DAMAGED)

    expect(passwords.remember('a', 'session', 'new')).toContain(filePath)

    expect(passwords.get('a')).toBeNull()
  })

  it('reports why sealing failed and keeps the in-memory copy', () => {
    passwords.rememberForSession('a', 'typed')
    keychainOpen = false

    expect(passwords.keep('a', 'forever', undefined)).toBe(NO_ENCRYPTION)

    expect(passwords.get('a')).toBe('typed')
  })

  it('undo removes a password sealed where none was saved before', () => {
    const undo = undoOf(passwords.release('a', 'forever', 'new'))
    expect(passwords.keep('a', 'forever', 'new')).toBeNull()

    expect(undo()).toBeNull()

    expect(reopened().ids()).toEqual([])
  })

  it('undo leaves alone a file it could not read before', () => {
    writeFileSync(filePath, DAMAGED)
    const undo = undoOf(passwords.release('a', 'forever', 'new'))
    expect(passwords.keep('a', 'forever', 'new')).toContain(filePath)

    expect(undo()).toBeNull()

    expect(readFileSync(filePath, 'utf8')).toBe(DAMAGED)
  })

  describe('when a write fails after it replaced the file', () => {
    it.each(['session', 'never'] as const)(
      'puts back the saved password a release removed (%s)',
      (storage) => {
        passwords.remember('a', 'forever', 'hunter2')
        writes.failAfterReplacing = 1

        expect(() => passwords.release('a', storage, undefined)).toThrow('fsync failed')

        expect(reopened().get('a')).toBe('hunter2')
      }
    )

    it('leaves nothing on disk when sealing a first password fails', () => {
      writes.failAfterReplacing = 1

      expect(() => passwords.remember('a', 'forever', 'hunter2')).toThrow('fsync failed')

      expect(reopened().ids()).toEqual([])
    })

    it('puts the previous password back when sealing a new one fails', () => {
      passwords.remember('a', 'forever', 'old')
      undoOf(passwords.release('a', 'forever', 'new'))
      writes.failAfterReplacing = 1

      expect(() => passwords.keep('a', 'forever', 'new')).toThrow('fsync failed')

      expect(reopened().get('a')).toBe('old')
    })

    it('puts a password back when forgetting it fails', () => {
      passwords.remember('a', 'forever', 'hunter2')
      writes.failAfterReplacing = 1

      expect(() => passwords.forget('a')).toThrow('fsync failed')

      expect(reopened().get('a')).toBe('hunter2')
    })

    it('says so when putting the password back fails too', () => {
      passwords.remember('a', 'forever', 'hunter2')
      writes.failAfterReplacing = 2

      expect(() => passwords.forget('a')).toThrow(
        'fsync failed The saved password could not be put back: fsync failed'
      )
    })

    it('has undo report its own failed write instead of throwing', () => {
      passwords.remember('a', 'forever', 'hunter2')
      const undo = undoOf(passwords.release('a', 'never', undefined))
      writes.failAfterReplacing = 1

      expect(undo()).toBe('fsync failed')
    })
  })
})
