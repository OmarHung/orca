import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { DatabasePickedScripts } from '../../shared/database/database-script-types'
import type { SqlScriptFileSource } from './worker/sql-script-runner'

// Long enough to read the files over and set options, short enough not to pile up.
const PICK_TTL_MS = 60 * 60 * 1000

type Pick = { files: SqlScriptFileSource[]; expiresAt: number }

// Why numeric order: per-table dumps are numbered (001_…, 002_…) in the order they must run.
const FILE_ORDER = new Intl.Collator(undefined, { numeric: true })

/**
 * Script files chosen in main's open dialog. The renderer only gets a token for them, so it
 * can run what the user picked but never name a path of its own.
 */
export class DatabaseScriptPicks {
  private readonly picks = new Map<string, Pick>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Remembers the paths the open dialog returned; null (a cancelled dialog) returns null. */
  async register(paths: string[] | null): Promise<DatabasePickedScripts | null> {
    if (!paths || paths.length === 0) {
      return null
    }
    const files = await Promise.all(
      paths.map(async (path) => ({ path, name: basename(path), size: (await stat(path)).size }))
    )
    const sorted = files.toSorted((a, b) => FILE_ORDER.compare(a.name, b.name))
    this.prune()
    const token = randomUUID()
    this.picks.set(token, { files: sorted, expiresAt: this.now() + PICK_TTL_MS })
    return { token, files: sorted.map(({ name, size }) => ({ name, size })) }
  }

  /** The files behind `token`, or null once it has expired (or never existed). */
  files(token: string): SqlScriptFileSource[] | null {
    this.prune()
    return this.picks.get(token)?.files ?? null
  }

  private prune(): void {
    const now = this.now()
    for (const [token, pick] of this.picks) {
      if (pick.expiresAt <= now) {
        this.picks.delete(token)
      }
    }
  }
}
