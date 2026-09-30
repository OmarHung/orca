import type { SecretStore } from '../shared/secret-store'
import { SealedSecretFile, type SealedSnapshot } from './sealed-secret-file'

/** How a saved login keeps its password; the database and VPN settings share these values. */
export type PasswordStorage = 'forever' | 'session' | 'never'

/** A finished release, with how to put the passwords back if saving the setting then fails. */
export type Released = { ok: true; undo: () => string | null } | { ok: false; problem: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The error to report once a failed setting save was undone; says so when undoing failed too. */
export function afterUndo(error: unknown, undoProblem: string | null): Error {
  const failure = error instanceof Error ? error : new Error(String(error))
  return undoProblem === null
    ? failure
    : new Error(`${failure.message} The saved password could not be put back: ${undoProblem}`)
}

/**
 * Undoes a setting change that failed after it was saved: the passwords first, since undo never
 * throws, then the setting. The error says what could not be put back.
 */
export function rollBack(error: unknown, undo: () => string | null, revert: () => void): Error {
  const undoProblem = undo()
  try {
    revert()
  } catch (revertError) {
    const both = `${messageOf(error)} The previous settings could not be put back: ${messageOf(revertError)}`
    return afterUndo(new Error(both), undoProblem)
  }
  return afterUndo(error, undoProblem)
}

const LOCKED_MESSAGE =
  'The saved password cannot be read right now because the system keychain is locked or unavailable. Enter the password again, or try again later.'

/**
 * Passwords by id: `forever` sealed with the OS keychain in a file (never plaintext), `session` in
 * memory until Orca quits, `never` not kept. Methods that change what is kept return a user-facing
 * problem, or null once done; on a problem nothing on disk was changed. A write can fail after it
 * already replaced the file, so a change that throws puts back what it changed before rethrowing.
 *
 * A setting change runs in two halves around saving the setting itself: `release` before it
 * removes what the new setting must not keep, and `keep` after it seals what the new setting
 * keeps. So a failed save of the setting never leaves a password on disk it did not ask for, and
 * `undo` from `release` puts back what it removed.
 */
export class KeptPasswords {
  private readonly session = new Map<string, string>()
  private readonly sealed: SealedSecretFile

  constructor(
    filePath: string,
    private readonly secretStore: () => SecretStore,
    private readonly noEncryptionMessage: string
  ) {
    this.sealed = new SealedSecretFile(filePath, secretStore)
  }

  canSeal(): boolean {
    return this.secretStore().isEncryptionAvailable()
  }

  get(id: string): string | null {
    return this.session.get(id) ?? this.sealed.get(id)
  }

  has(id: string): boolean {
    return this.session.has(id) || this.sealed.has(id)
  }

  ids(): string[] {
    return [...new Set([...this.session.keys(), ...(this.sealed.ids() ?? [])])]
  }

  rememberForSession(id: string, password: string): void {
    this.session.set(id, password)
  }

  forget(id: string): string | null {
    return this.allOrNothing(id, () => this.forgetNow(id))
  }

  /** Keeps a password just typed the way `storage` says, replacing whatever was kept. */
  remember(id: string, storage: PasswordStorage, password: string): string | null {
    return this.allOrNothing(id, () =>
      storage === 'forever' ? this.seal(id, password) : this.releaseNow(id, storage, password)
    )
  }

  /**
   * First half of a setting change. `password` is a new one, `null` clears it, and `undefined`
   * keeps the one already kept. For `session` a saved copy moves into memory, and a copy the
   * keychain cannot open now is refused rather than dropped.
   */
  release(id: string, storage: PasswordStorage, password: string | null | undefined): Released {
    return this.allOrNothing(id, (undo) => {
      const problem = this.releaseNow(id, storage, password)
      return problem === null ? { ok: true, undo } : { ok: false, problem }
    })
  }

  private releaseNow(
    id: string,
    storage: PasswordStorage,
    password: string | null | undefined
  ): string | null {
    if (password === null || storage === 'never') {
      return this.forgetNow(id)
    }
    if (storage === 'forever') {
      return null
    }
    let kept = password ?? this.session.get(id)
    if (kept === undefined) {
      const found = this.sealed.lookup(id)
      if (found.state === 'unavailable') {
        return LOCKED_MESSAGE
      }
      if (found.state === 'problem') {
        return this.sealed.describeProblem(found.problem)
      }
      kept = found.state === 'available' ? found.secret : undefined
    }
    const removed = this.deleteSealed(id)
    if (removed === null && kept !== undefined) {
      this.session.set(id, kept)
    }
    return removed
  }

  /** Second half of a setting change: seals a new or in-memory password for `forever`. */
  keep(id: string, storage: PasswordStorage, password: string | null | undefined): string | null {
    if (storage !== 'forever' || password === null) {
      return null
    }
    const kept = password ?? this.session.get(id)
    // Why: with nothing new, the copy already saved stays untouched, even if the keychain is locked.
    return kept === undefined ? null : this.allOrNothing(id, () => this.seal(id, kept))
  }

  /** Runs one change to `id`, handing it the undo; if the change throws, undoes it first. */
  private allOrNothing<T>(id: string, change: (undo: () => string | null) => T): T {
    const sessionBefore = this.session.get(id)
    // Why the raw ciphertext: putting it back needs no keychain, so undo works even while it is locked.
    const sealedBefore = this.sealed.snapshot(id)
    const undo = (): string | null => this.restore(id, sessionBefore, sealedBefore)
    try {
      return change(undo)
    } catch (error) {
      throw afterUndo(error, undo())
    }
  }

  /** Never throws, so a failed change can always be undone. */
  private restore(
    id: string,
    sessionBefore: string | undefined,
    sealedBefore: SealedSnapshot
  ): string | null {
    if (sessionBefore === undefined) {
      this.session.delete(id)
    } else {
      this.session.set(id, sessionBefore)
    }
    try {
      const problem = this.sealed.restore(id, sealedBefore)
      return problem === null ? null : this.sealed.describeProblem(problem)
    } catch (error) {
      return messageOf(error)
    }
  }

  private seal(id: string, password: string): string | null {
    const sealed = this.sealed.seal(id, password)
    if (sealed === 'no-encryption') {
      return this.noEncryptionMessage
    }
    if (sealed !== 'sealed') {
      return this.sealed.describeProblem(sealed)
    }
    this.session.delete(id)
    return null
  }

  private forgetNow(id: string): string | null {
    this.session.delete(id)
    return this.deleteSealed(id)
  }

  private deleteSealed(id: string): string | null {
    const deleted = this.sealed.delete(id)
    return deleted === 'deleted' ? null : this.sealed.describeProblem(deleted)
  }
}
