import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { utils } from 'ssh2'
import type { SecretStore } from '../../shared/secret-store'
import { SealedSecretFile } from '../sealed-secret-file'
import { resolveSshConfigHomePath } from './ssh-config-path-expansion'

export type SshPassphraseCheck = 'correct' | 'wrong' | 'unverifiable'

// ssh2 says "no passphrase given" for a locked key and "bad passphrase?" for a wrong one.
const PASSPHRASE_ERROR = /passphrase|bad decrypt/i

/** The absolute key file a passphrase prompt names, or null when it names none ("(unknown)"). */
export function normalizeSshKeyPath(detail: string): string | null {
  const expanded = resolveSshConfigHomePath(detail.trim())
  return expanded && isAbsolute(expanded) ? resolve(expanded) : null
}

function readKeyFile(keyPath: string): Buffer | null {
  try {
    return readFileSync(keyPath)
  } catch {
    return null
  }
}

function isEncryptedKey(contents: Buffer): boolean {
  const parsed = utils.parseKey(contents)
  return parsed instanceof Error && PASSPHRASE_ERROR.test(parsed.message)
}

export function checkSshKeyPassphrase(contents: Buffer, passphrase: string): SshPassphraseCheck {
  const parsed = utils.parseKey(contents, passphrase)
  if (!(parsed instanceof Error)) {
    return 'correct'
  }
  return PASSPHRASE_ERROR.test(parsed.message) ? 'wrong' : 'unverifiable'
}

function checkStamp(keyPath: string, passphrase: string): string | null {
  try {
    const { mtimeMs, size } = statSync(keyPath)
    const digest = createHash('sha256').update(passphrase).digest('hex')
    return `${mtimeMs}:${size}:${digest}`
  } catch {
    return null
  }
}

/**
 * SSH key passphrases the user asked Orca to remember, keyed by key file path and sealed with
 * the OS keychain. A saved passphrase is re-checked against the key before use, so a rotated key
 * asks again instead of failing the connection.
 */
export class SshSavedPassphraseStore {
  private readonly sealed: SealedSecretFile
  // Why: an OpenSSH key's bcrypt KDF blocks the main thread ~200ms per check; skip repeats until the file changes.
  private readonly verified = new Map<string, string>()

  constructor(
    filePath: string,
    private readonly secretStore: () => SecretStore
  ) {
    this.sealed = new SealedSecretFile(filePath, secretStore)
  }

  /** Only when the keychain really seals (not Linux's obfuscating fallback) and the key is encrypted. */
  canRemember(keyPath: string): boolean {
    const store = this.secretStore()
    if (!store.isEncryptionAvailable() || store.describeProtectionGap() !== null) {
      return false
    }
    const contents = readKeyFile(keyPath)
    return contents !== null && isEncryptedKey(contents)
  }

  check(keyPath: string, passphrase: string): SshPassphraseCheck {
    const stamp = checkStamp(keyPath, passphrase)
    if (stamp !== null && this.verified.get(keyPath) === stamp) {
      return 'correct'
    }
    const contents = readKeyFile(keyPath)
    if (contents === null) {
      return 'unverifiable'
    }
    const result = checkSshKeyPassphrase(contents, passphrase)
    if (result === 'correct' && stamp !== null) {
      this.verified.set(keyPath, stamp)
    }
    return result
  }

  /** The saved passphrase when it still unlocks the key; a stale one is dropped. */
  lookup(keyPath: string): string | null {
    const passphrase = this.sealed.get(keyPath)
    if (passphrase === null) {
      return null
    }
    const result = this.check(keyPath, passphrase)
    if (result === 'wrong') {
      this.forget(keyPath)
    }
    return result === 'correct' ? passphrase : null
  }

  /** Callers check the passphrase first; this only refuses what it cannot seal. */
  remember(keyPath: string, passphrase: string): boolean {
    return this.canRemember(keyPath) && this.sealed.seal(keyPath, passphrase) === 'sealed'
  }

  list(): string[] {
    return (this.sealed.ids() ?? []).toSorted()
  }

  /** `null` once removed; otherwise why the file was left untouched. */
  forget(keyPath: string): string | null {
    this.verified.delete(keyPath)
    const deleted = this.sealed.delete(keyPath)
    return deleted === 'deleted' ? null : this.sealed.describeProblem(deleted)
  }
}
