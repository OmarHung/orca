import { existsSync, readFileSync } from 'node:fs'
import { isUnreadableError, writeDurableSecureJsonFile } from '../shared/secure-file'
import type { SecretStore } from '../shared/secret-store'

type SealedSecretFileContents = {
  version: 1
  format: 'orca-secret-store-v1'
  /** id → base64 ciphertext. */
  ciphertexts: Record<string, string>
}

export type SealResult = 'sealed' | 'no-encryption' | 'unreadable'

/** A JSON file of id → secret, each sealed with the OS keychain. Never holds plaintext. */
export class SealedSecretFile {
  constructor(
    private readonly filePath: string,
    private readonly secretStore: () => SecretStore
  ) {}

  /** `null` when the file exists but could not be read. */
  ids(): string[] | null {
    const file = this.read()
    return file ? Object.keys(file.ciphertexts) : null
  }

  has(id: string): boolean {
    const file = this.read()
    return file !== null && Object.hasOwn(file.ciphertexts, id)
  }

  get(id: string): string | null {
    const ciphertext = this.read()?.ciphertexts[id]
    if (typeof ciphertext !== 'string') {
      return null
    }
    const store = this.secretStore()
    if (!store.isEncryptionAvailable()) {
      return null
    }
    try {
      return store.decryptString(Buffer.from(ciphertext, 'base64'))
    } catch {
      // A keychain reset makes old ciphertext undecryptable; asking again is the recovery.
      return null
    }
  }

  seal(id: string, secret: string): SealResult {
    const store = this.secretStore()
    if (!store.isEncryptionAvailable()) {
      return 'no-encryption'
    }
    const file = this.read()
    if (!file) {
      return 'unreadable'
    }
    const ciphertext = store.encryptString(secret).toString('base64')
    this.write({ ...file, ciphertexts: { ...file.ciphertexts, [id]: ciphertext } })
    return 'sealed'
  }

  /** False when the file exists but could not be read, so nothing was removed. */
  delete(id: string): boolean {
    const file = this.read()
    if (!file) {
      return false
    }
    if (Object.hasOwn(file.ciphertexts, id)) {
      const { [id]: _removed, ...rest } = file.ciphertexts
      this.write({ ...file, ciphertexts: rest })
    }
    return true
  }

  /** `null` means the file exists but could not be read — never treat that as empty. */
  private read(): SealedSecretFileContents | null {
    const empty: SealedSecretFileContents = {
      version: 1,
      format: 'orca-secret-store-v1',
      ciphertexts: {}
    }
    if (!existsSync(this.filePath)) {
      return empty
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      const ciphertexts: unknown =
        typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'ciphertexts') : null
      if (typeof ciphertexts !== 'object' || ciphertexts === null || Array.isArray(ciphertexts)) {
        return empty
      }
      const entries = Object.entries(ciphertexts).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
      return { ...empty, ciphertexts: Object.fromEntries(entries) }
    } catch (error) {
      return isUnreadableError(error) ? null : empty
    }
  }

  private write(file: SealedSecretFileContents): void {
    writeDurableSecureJsonFile(this.filePath, file)
  }
}
