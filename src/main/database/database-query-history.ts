import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  DATABASE_HISTORY_LIMIT,
  DATABASE_HISTORY_MAX_SQL_CHARS,
  DATABASE_HISTORY_MAX_TOTAL_CHARS,
  type DatabaseHistoryEntry
} from '../../shared/database/database-query-history-types'
import { writeSecureFile } from '../../shared/secure-file'
import { isENOENT } from '../ipc/filesystem-path-containment'

const historyFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(
    z.object({
      sql: z.string().max(DATABASE_HISTORY_MAX_SQL_CHARS),
      at: z.number(),
      outcome: z.enum(['ok', 'error', 'cancelled']),
      durationMs: z.number()
    })
  )
})

/** The newest entries whose SQL fits the total budget. */
function newestWithinBudget(entries: readonly DatabaseHistoryEntry[]): DatabaseHistoryEntry[] {
  let total = 0
  let start = entries.length
  while (start > 0 && total + entries[start - 1]!.sql.length <= DATABASE_HISTORY_MAX_TOTAL_CHARS) {
    start -= 1
    total += entries[start]!.sql.length
  }
  return entries.slice(Math.max(start, entries.length - DATABASE_HISTORY_LIMIT))
}

/**
 * Console statements per connection in `userData/database/history/<connectionId>.json`, oldest
 * first. Callers validate the id against the connection id pattern before it reaches a path.
 */
export class DatabaseQueryHistory {
  // Why: two consoles on one connection can finish together; each write must see the other's.
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly rootDir: string) {}

  /** Newest first, after any write still in flight. */
  list(connectionId: string): Promise<DatabaseHistoryEntry[]> {
    return this.enqueue(connectionId, async () => (await this.read(connectionId)).toReversed())
  }

  record(connectionId: string, entry: DatabaseHistoryEntry): Promise<void> {
    const sql = entry.sql.trim()
    if (!sql || sql.length > DATABASE_HISTORY_MAX_SQL_CHARS) {
      return Promise.resolve()
    }
    return this.enqueue(connectionId, async () => {
      // Re-running a statement moves it to the top instead of listing it twice.
      const kept = (await this.read(connectionId)).filter((existing) => existing.sql !== sql)
      const entries = newestWithinBudget([...kept, { ...entry, sql }])
      // 0600: statements often carry customer data and credentials. Not durable: losing the
      // last entry in a crash is fine, an fsync per statement isn't.
      writeSecureFile(this.historyPath(connectionId), JSON.stringify({ version: 1, entries }))
    })
  }

  clear(connectionId: string): Promise<void> {
    return this.enqueue(connectionId, () => rm(this.historyPath(connectionId), { force: true }))
  }

  private async read(connectionId: string): Promise<DatabaseHistoryEntry[]> {
    let text: string
    try {
      text = await readFile(this.historyPath(connectionId), 'utf8')
    } catch (error) {
      if (isENOENT(error)) {
        return []
      }
      throw error
    }
    try {
      const parsed = historyFileSchema.safeParse(JSON.parse(text))
      return parsed.success ? parsed.data.entries : []
    } catch {
      // A damaged file shouldn't block running queries; the next write replaces it.
      return []
    }
  }

  private enqueue<T>(connectionId: string, task: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(connectionId) ?? Promise.resolve()).then(task, task)
    this.queues.set(
      connectionId,
      next.catch(() => undefined)
    )
    return next
  }

  private historyPath(connectionId: string): string {
    return join(this.rootDir, `${connectionId}.json`)
  }
}
