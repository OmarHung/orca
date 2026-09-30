import { readFileSync } from 'node:fs'
import { writeDurableSecureJsonFile } from '../shared/secure-file'
import type { SecretStore } from '../shared/secret-store'

const FILE_VERSION = 1
const FILE_FORMAT = 'orca-secret-store-v1'

type SealedSecretFileContents = {
  version: typeof FILE_VERSION
  format: typeof FILE_FORMAT
  /** id → base64 ciphertext. */
  ciphertexts: Record<string, string>
}

/** Why an existing file cannot be used. Each one leaves the file untouched for the user to handle. */
export type SecretFileProblem = 'unreadable' | 'damaged' | 'newer-format'

export type SealResult = 'sealed' | 'no-encryption' | SecretFileProblem

export type DeleteResult = 'deleted' | SecretFileProblem

/** What the file holds for one id; `unavailable` is a saved secret the keychain cannot open now. */
export type SealedLookup =
  | { state: 'absent' }
  | { state: 'available'; secret: string }
  | { state: 'unavailable' }
  | { state: 'problem'; problem: SecretFileProblem }

type ReadResult = { contents: SealedSecretFileContents } | { problem: SecretFileProblem }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown): boolean {
  return isObject(error) && error.code === 'ENOENT'
}

function parseContents(text: string): ReadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { problem: 'damaged' }
  }
  if (!isObject(parsed)) {
    return { problem: 'damaged' }
  }
  if (typeof parsed.version === 'number' && parsed.version > FILE_VERSION) {
    return { problem: 'newer-format' }
  }
  const { ciphertexts } = parsed
  if (parsed.version !== FILE_VERSION || parsed.format !== FILE_FORMAT || !isObject(ciphertexts)) {
    return { problem: 'damaged' }
  }
  const entries: [string, string][] = []
  for (const [id, ciphertext] of Object.entries(ciphertexts)) {
    // Why: dropping one bad entry here would erase it on the next write.
    if (typeof ciphertext !== 'string') {
      return { problem: 'damaged' }
    }
    entries.push([id, ciphertext])
  }
  return {
    contents: {
      version: FILE_VERSION,
      format: FILE_FORMAT,
      ciphertexts: Object.fromEntries(entries)
    }
  }
}

/** A JSON file of id → secret, each sealed with the OS keychain. Never holds plaintext. */
export class SealedSecretFile {
  constructor(
    private readonly filePath: string,
    private readonly secretStore: () => SecretStore
  ) {}

  /** `null` when the file exists but cannot be used. */
  ids(): string[] | null {
    const read = this.read()
    return 'contents' in read ? Object.keys(read.contents.ciphertexts) : null
  }

  has(id: string): boolean {
    const read = this.read()
    return 'contents' in read && Object.hasOwn(read.contents.ciphertexts, id)
  }

  get(id: string): string | null {
    const found = this.lookup(id)
    return found.state === 'available' ? found.secret : null
  }

  /** Unlike get(), tells a missing secret apart from one that exists but cannot be read now. */
  lookup(id: string): SealedLookup {
    const read = this.read()
    if ('problem' in read) {
      return { state: 'problem', problem: read.problem }
    }
    if (!Object.hasOwn(read.contents.ciphertexts, id)) {
      return { state: 'absent' }
    }
    const store = this.secretStore()
    if (!store.isEncryptionAvailable()) {
      return { state: 'unavailable' }
    }
    try {
      const ciphertext = Buffer.from(read.contents.ciphertexts[id] ?? '', 'base64')
      return { state: 'available', secret: store.decryptString(ciphertext) }
    } catch {
      // Why unavailable: a locked keychain and a reset one fail alike, so never treat it as gone.
      return { state: 'unavailable' }
    }
  }

  seal(id: string, secret: string): SealResult {
    const store = this.secretStore()
    if (!store.isEncryptionAvailable()) {
      return 'no-encryption'
    }
    const read = this.read()
    if ('problem' in read) {
      return read.problem
    }
    const ciphertext = store.encryptString(secret).toString('base64')
    this.write({
      ...read.contents,
      ciphertexts: { ...read.contents.ciphertexts, [id]: ciphertext }
    })
    return 'sealed'
  }

  /** A problem means the file exists but cannot be used, so nothing was removed. */
  delete(id: string): DeleteResult {
    const read = this.read()
    if ('problem' in read) {
      return read.problem
    }
    if (Object.hasOwn(read.contents.ciphertexts, id)) {
      const { [id]: _removed, ...rest } = read.contents.ciphertexts
      this.write({ ...read.contents, ciphertexts: rest })
    }
    return 'deleted'
  }

  /** User-facing reason nothing was saved or removed. */
  describeProblem(problem: SecretFileProblem): string {
    switch (problem) {
      case 'unreadable':
        return `Orca's saved-credentials file (${this.filePath}) exists but could not be read; refusing to overwrite it.`
      case 'damaged':
        return `Orca's saved-credentials file (${this.filePath}) is damaged, so Orca will not overwrite it. Repair it, or move it away to start a new one.`
      case 'newer-format':
        return `Orca's saved-credentials file (${this.filePath}) was written by a newer version of Orca. Update Orca to change saved passwords.`
    }
  }

  /** Only a missing file counts as empty; any other file that fails to parse is never overwritten. */
  private read(): ReadResult {
    let text: string
    try {
      text = readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if (isMissingFileError(error)) {
        return { contents: { version: FILE_VERSION, format: FILE_FORMAT, ciphertexts: {} } }
      }
      return { problem: 'unreadable' }
    }
    return parseContents(text)
  }

  private write(file: SealedSecretFileContents): void {
    writeDurableSecureJsonFile(this.filePath, file)
  }
}
