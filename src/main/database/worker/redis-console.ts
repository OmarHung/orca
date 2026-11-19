import type Redis from 'ioredis'
import type {
  DatabaseExecuteResult,
  DatabaseQueryResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import { parseRedisCommandWords } from '../../../shared/database/redis-command-text'
import { REDIS_VIEW_COMMAND } from '../../../shared/database/redis-read-only-commands'
import { ConsoleSchema } from './console-schema'
import { DatabaseCancelledError } from './database-error-mapping'
import { arrayRowReader, OpenResultPager } from './open-result-pager'
import { closeRedisClient } from './redis-client-factory'
import { openRedisKeyView } from './redis-key-view'
import { redisReplyTables } from './redis-replies'

const DATABASE_NAME = /^db(\d+)$/

/** The explorer's name for database `index`, which the console picker also uses. */
export function redisDatabaseName(index: number): string {
  return `db${index}`
}

export function parseRedisDatabaseName(name: string): number {
  const match = DATABASE_NAME.exec(name)
  if (!match) {
    throw new Error(`${name} is not a Redis database; pick one of db0, db1, …`)
  }
  return Number(match[1])
}

/** One console's own Redis session. */
export class RedisConsole {
  private readonly pager = new OpenResultPager()
  private cancelled = false
  readonly schema: ConsoleSchema

  constructor(
    readonly client: Redis,
    private database: number
  ) {
    this.schema = new ConsoleSchema({
      apply: async (name) => {
        const index = parseRedisDatabaseName(name)
        await this.client.call('SELECT', index)
        this.database = index
      },
      current: async () => redisDatabaseName(this.database),
      mayChange: (command) => /^\s*select\b/i.test(command)
    })
  }

  async execute(command: string, pageSize: number): Promise<DatabaseExecuteResult> {
    await this.pager.release()
    this.cancelled = false
    const startedAt = performance.now()
    const words = parseRedisCommandWords(command)
    if (words.length === 0) {
      return { results: [{ kind: 'command', command: '', rowCount: null, durationMs: 0 }] }
    }
    try {
      if (words[0].toUpperCase() === REDIS_VIEW_COMMAND) {
        if (words.length !== 2) {
          throw new Error(`${REDIS_VIEW_COMMAND} takes one key.`)
        }
        const view = await openRedisKeyView(this.client, words[1])
        return { results: [await this.pager.start(view.columns, view.reader, pageSize, startedAt)] }
      }
      const reply = await this.client.callBuffer(words[0], ...words.slice(1))
      if (words[0].toUpperCase() === 'SELECT') {
        this.database = Number(words[1])
      }
      return { results: await this.results(words, reply, pageSize, startedAt) }
    } catch (error) {
      throw this.cancelled ? new DatabaseCancelledError() : error
    }
  }

  private async results(
    words: string[],
    reply: unknown,
    pageSize: number,
    startedAt: number
  ): Promise<DatabaseQueryResult[]> {
    const durationMs = Math.round(performance.now() - startedAt)
    const results: DatabaseQueryResult[] = []
    let paged = false
    for (const table of redisReplyTables(words, reply)) {
      if (table.kind === 'command') {
        results.push({ kind: 'command', command: table.command, rowCount: null, durationMs })
      } else if (!paged) {
        // Why only the first: a console keeps one result open for Load More.
        paged = true
        results.push(
          await this.pager.start(table.columns, arrayRowReader(table.rows), pageSize, startedAt)
        )
      } else {
        const result = await new OpenResultPager().start(
          table.columns,
          arrayRowReader(table.rows),
          Number.MAX_SAFE_INTEGER,
          startedAt
        )
        results.push(result)
      }
    }
    return results
  }

  fetch(resultId: string, pageSize: number): Promise<DatabaseRowsPage> {
    return this.pager.fetch(resultId, pageSize)
  }

  /** Stops a running command by dropping the session; the console reconnects on its next run. */
  cancel(): void {
    this.cancelled = true
    closeRedisClient(this.client)
  }

  async close(): Promise<void> {
    await this.pager.release()
    closeRedisClient(this.client)
  }
}
