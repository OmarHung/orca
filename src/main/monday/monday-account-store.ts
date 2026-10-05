import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { SecretStore } from '../../shared/secret-store'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import type { MondayAccount } from '../../shared/monday/monday-types'
import { KeptPasswords } from '../kept-passwords'

const TOKEN_ID = 'personal-token'

function isAccount(value: unknown): value is MondayAccount {
  if (!value || typeof value !== 'object') {
    return false
  }
  return ['userId', 'userName', 'email', 'accountSlug', 'accountName'].every(
    (key) => key in value && typeof Reflect.get(value, key) === 'string'
  )
}

/**
 * The personal API token, sealed with the OS keychain under `userData/monday/` — or kept in
 * memory until Orca quits when there is no keychain, never as plaintext on disk.
 */
export class MondayAccountStore {
  private readonly tokens: KeptPasswords
  private readonly accountPath: string
  private cachedAccount: MondayAccount | null | undefined

  constructor(dataDir: string, secretStore: () => SecretStore) {
    this.tokens = new KeptPasswords(
      join(dataDir, 'token.json'),
      secretStore,
      'This system has no secure storage for the monday token.'
    )
    this.accountPath = join(dataDir, 'account.json')
  }

  token(): string | null {
    return this.tokens.get(TOKEN_ID)
  }

  account(): MondayAccount | null {
    if (this.cachedAccount === undefined) {
      this.cachedAccount = this.readAccount()
    }
    // An account without a token (keychain locked, session-only token gone) is not connected.
    return this.token() ? this.cachedAccount : null
  }

  /** Returns true when the token could only be kept until Orca quits. */
  save(token: string, account: MondayAccount): boolean {
    const sessionOnly = !this.tokens.canSeal()
    if (sessionOnly) {
      this.tokens.rememberForSession(TOKEN_ID, token)
    } else {
      const problem = this.tokens.remember(TOKEN_ID, 'forever', token)
      if (problem) {
        throw new Error(problem)
      }
    }
    writeDurableSecureJsonFile(this.accountPath, account)
    this.cachedAccount = account
    return sessionOnly
  }

  isSessionOnly(): boolean {
    return !this.tokens.canSeal()
  }

  clear(): void {
    const problem = this.tokens.forget(TOKEN_ID)
    if (problem) {
      throw new Error(problem)
    }
    rmSync(this.accountPath, { force: true })
    this.cachedAccount = null
  }

  private readAccount(): MondayAccount | null {
    if (!existsSync(this.accountPath)) {
      return null
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.accountPath, 'utf8'))
      return isAccount(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}
