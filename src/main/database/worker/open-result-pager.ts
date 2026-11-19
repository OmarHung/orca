import { randomUUID } from 'node:crypto'
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseRowsPage,
  DatabaseRowsResult
} from '../../../shared/database/database-query-types'

export type RowPage = { rows: DatabaseCell[][]; done: boolean }

/** Reads the rows after those already handed out, up to `count` (fewer only at the end). */
export type RowReader = {
  read: (count: number) => Promise<RowPage>
  close: () => Promise<void>
}

export const NOT_OPEN_MESSAGE =
  'This result is no longer open. Run the statement again to load more rows.'

/** Serves rows already in memory a page at a time. */
export function arrayRowReader(rows: DatabaseCell[][]): RowReader {
  let next = 0
  return {
    read: async (count) => {
      const page = rows.slice(next, next + count)
      next += page.length
      return { rows: page, done: next >= rows.length }
    },
    close: async () => undefined
  }
}

/**
 * The one result a Redis or MongoDB console keeps open for Load More; running another
 * statement or closing the console releases it (and its server cursor).
 */
export class OpenResultPager {
  private open: { resultId: string; reader: RowReader } | null = null

  /** Reads the first page and keeps `reader` open when more rows remain. */
  async start(
    columns: DatabaseColumn[],
    reader: RowReader,
    pageSize: number,
    startedAt: number
  ): Promise<DatabaseRowsResult> {
    await this.release()
    let first: RowPage
    try {
      first = await reader.read(pageSize)
    } catch (error) {
      await reader.close().catch(() => undefined)
      throw error
    }
    return this.hold(columns, first, reader, startedAt)
  }

  /** Like `start`, for a driver that had to read the first page itself (e.g. to find columns). */
  async hold(
    columns: DatabaseColumn[],
    first: RowPage,
    reader: RowReader,
    startedAt: number
  ): Promise<DatabaseRowsResult> {
    const resultId = randomUUID()
    if (first.done) {
      await reader.close().catch(() => undefined)
    } else {
      this.open = { resultId, reader }
    }
    return {
      kind: 'rows',
      resultId,
      columns,
      rows: first.rows,
      hasMore: !first.done,
      durationMs: Math.round(performance.now() - startedAt)
    }
  }

  async fetch(resultId: string, pageSize: number): Promise<DatabaseRowsPage> {
    const open = this.open
    if (!open || open.resultId !== resultId) {
      throw new Error(NOT_OPEN_MESSAGE)
    }
    const page = await open.reader.read(pageSize)
    if (page.done) {
      this.open = null
      await open.reader.close().catch(() => undefined)
    }
    return { rows: page.rows, hasMore: !page.done }
  }

  async release(): Promise<void> {
    const open = this.open
    this.open = null
    await open?.reader.close().catch(() => undefined)
  }
}
