import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isUnreadableError, writeDurableSecureJsonFile } from '../../shared/secure-file'
import {
  sshCommandSchema,
  type SshCommand,
  type SshCommandDraft
} from '../../shared/ssh-command-types'

const FILE_VERSION = 1

type StoreFile = { version: typeof FILE_VERSION; commands: unknown[] }

type StoreState = {
  commands: SshCommand[]
  /** Records this version can't read. Written back untouched, so a save never erases them. */
  unreadable: unknown[]
}

/** Saved SSH commands in `userData/ssh-commands.json`, cached until the file changes. */
export class SshCommandStore {
  private cache: { state: StoreState; mtimeMs: number | null } | null = null

  constructor(private readonly filePath: string) {}

  list(): SshCommand[] {
    return this.state().commands
  }

  /** Replaces the command with `id`, or adds one under `id` (a new id when none is given). */
  save(id: string | undefined, draft: SshCommandDraft): SshCommand {
    const state = this.state()
    const saved: SshCommand = { ...draft, id: id ?? randomUUID() }
    const exists = state.commands.some((command) => command.id === saved.id)
    this.write({
      ...state,
      commands: exists
        ? state.commands.map((command) => (command.id === saved.id ? saved : command))
        : [...state.commands, saved]
    })
    return saved
  }

  delete(id: string): void {
    const state = this.state()
    const commands = state.commands.filter((command) => command.id !== id)
    if (commands.length !== state.commands.length) {
      this.write({ ...state, commands })
    }
  }

  private state(): StoreState {
    // Why mtime: a hand edit must take effect without a restart.
    const mtimeMs = this.mtimeMs()
    if (!this.cache || this.cache.mtimeMs !== mtimeMs) {
      this.cache = { state: this.read(), mtimeMs }
    }
    return this.cache.state
  }

  private mtimeMs(): number | null {
    try {
      return statSync(this.filePath).mtimeMs
    } catch {
      return null
    }
  }

  private read(): StoreState {
    if (!existsSync(this.filePath)) {
      return { commands: [], unreadable: [] }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
    } catch (error) {
      // Why throw: reading "empty" would let the next save erase every saved command.
      if (isUnreadableError(error)) {
        throw error
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `The SSH commands file ${this.filePath} is not valid JSON (${reason}). Fix or delete it.`
      )
    }
    const raw = typeof parsed === 'object' && parsed !== null ? parsed : {}
    const entries: unknown = Reflect.get(raw, 'commands')
    // Why throw: a newer version's file or another shape isn't empty, and a save would erase it.
    if (Reflect.get(raw, 'version') !== FILE_VERSION || !Array.isArray(entries)) {
      throw new Error(
        `The SSH commands file ${this.filePath} is in a format this version of Orca can't read. Update Orca, or fix or delete the file.`
      )
    }
    const commands: SshCommand[] = []
    const unreadable: unknown[] = []
    for (const entry of entries) {
      const result = sshCommandSchema.safeParse(entry)
      if (result.success) {
        commands.push(result.data)
      } else {
        unreadable.push(entry)
      }
    }
    return { commands, unreadable }
  }

  private write(state: StoreState): void {
    const file: StoreFile = {
      version: FILE_VERSION,
      commands: [...state.commands, ...state.unreadable]
    }
    // Why first: a write can fail after it replaced the file, so the next read must go to disk.
    this.cache = null
    writeDurableSecureJsonFile(this.filePath, file)
    this.cache = { state, mtimeMs: this.mtimeMs() }
  }
}
