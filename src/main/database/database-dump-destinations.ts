import { randomUUID } from 'node:crypto'
import type { DatabaseDumpDestination } from '../../shared/database/database-dump-types'
import type { DumpDestination } from './worker/dump/dump-output'

// Long enough to set the dump's options, short enough not to pile up.
const DESTINATION_TTL_MS = 60 * 60 * 1000

type Entry = { destination: DumpDestination; expiresAt: number }

/**
 * Where dumps go, chosen in main's dialogs. The renderer only gets a token for each, so it can
 * start a dump there but never name a path of its own.
 */
export class DatabaseDumpDestinations {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly now: () => number = Date.now) {}

  register(destination: DumpDestination): DatabaseDumpDestination {
    this.prune()
    const token = randomUUID()
    this.entries.set(token, { destination, expiresAt: this.now() + DESTINATION_TTL_MS })
    return { token, label: destination.path }
  }

  /** The destination behind `token`, good for one dump; null once used or expired. */
  take(token: string): DumpDestination | null {
    this.prune()
    const entry = this.entries.get(token)
    this.entries.delete(token)
    return entry?.destination ?? null
  }

  private prune(): void {
    const now = this.now()
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(token)
      }
    }
  }
}
