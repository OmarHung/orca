import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import Cursor from 'pg-cursor'
import type {
  DatabaseCell,
  DatabaseQueryResult,
  DatabaseRowsPage,
  DatabaseTransactionState
} from '../../../shared/database/database-query-types'
import { ConsoleTransactions } from './console-transactions'
import { encodeTextCell } from './database-cell-encoding'
import type { PostgresTypeNames } from './postgres-type-names'
import type { DatabaseChangeTransaction } from './table-change-transaction'

const BOOL_OID = 16

// Why identity parsers: keep the server's text form so numerics and timestamps stay exact.
const TEXT_TYPE_PARSERS: pg.CustomTypesConfig = {
  getTypeParser: () => (value: string) => value
}

type OpenResult = { resultId: string; cursor: Cursor<unknown[]>; boolColumns: boolean[] }

function readPage(
  cursor: Cursor<unknown[]>,
  rows: number
): Promise<{ rows: unknown[][]; result: pg.QueryResult }> {
  return new Promise((resolve, reject) => {
    cursor.read(rows, (error, page, result) =>
      error ? reject(error) : resolve({ rows: page, result })
    )
  })
}

function encodeRows(rows: unknown[][], boolColumns: boolean[]): DatabaseCell[][] {
  return rows.map((row) =>
    row.map((value, column) => {
      if (boolColumns[column] && (value === 't' || value === 'f')) {
        return value === 't' ? 'true' : 'false'
      }
      return encodeTextCell(value)
    })
  )
}

function transactionState(status: string | null): DatabaseTransactionState {
  return status === 'T' ? 'open' : status === 'E' ? 'failed' : 'none'
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt)
}

/** One console's server session plus the cursor of its most recent row-returning statement. */
export class PostgresConsole {
  private openResult: OpenResult | null = null
  readonly transactions = new ConsoleTransactions({
    // Why the empty query: a failed statement reports its error before the server's final status.
    state: async () => {
      await this.client.query('')
      return transactionState(this.client.getTransactionStatus())
    },
    begin: async () => {
      await this.closeOpenResult()
      await this.client.query('BEGIN')
    }
  })

  constructor(
    readonly client: pg.Client,
    readonly backendPid: number,
    private readonly typeNames: PostgresTypeNames
  ) {}

  async execute(sql: string, pageSize: number): Promise<DatabaseQueryResult> {
    await this.closeOpenResult()
    const startedAt = performance.now()
    const cursor = this.client.query(
      new Cursor<unknown[]>(sql, undefined, { rowMode: 'array', types: TEXT_TYPE_PARSERS })
    )
    const page = await readPage(cursor, pageSize)
    const fields = page.result.fields
    if (fields.length === 0) {
      return {
        kind: 'command',
        command: page.result.command ?? '',
        rowCount: page.result.rowCount ?? null,
        durationMs: elapsedMs(startedAt)
      }
    }
    const durationMs = elapsedMs(startedAt)
    const boolColumns = fields.map((field) => field.dataTypeID === BOOL_OID)
    const typeNames = await this.typeNames.resolve(fields)
    const hasMore = page.rows.length === pageSize
    const resultId = randomUUID()
    if (hasMore) {
      this.openResult = { resultId, cursor, boolColumns }
    } else {
      await cursor.close()
    }
    return {
      kind: 'rows',
      resultId,
      columns: fields.map((field, index) => ({ name: field.name, typeName: typeNames[index]! })),
      rows: encodeRows(page.rows, boolColumns),
      hasMore,
      durationMs
    }
  }

  async fetch(resultId: string, pageSize: number): Promise<DatabaseRowsPage> {
    const open = this.openResult
    if (!open || open.resultId !== resultId) {
      throw new Error('This result is no longer open. Run the statement again to load more rows.')
    }
    const page = await readPage(open.cursor, pageSize)
    const hasMore = page.rows.length === pageSize
    if (!hasMore) {
      await this.closeOpenResult()
    }
    return { rows: encodeRows(page.rows, open.boolColumns), hasMore }
  }

  async beginChanges(): Promise<DatabaseChangeTransaction> {
    await this.closeOpenResult()
    await this.client.query('BEGIN')
    return {
      run: async ({ sql, params }) =>
        (await this.client.query({ text: sql, values: params })).rowCount ?? 0,
      commit: async () => void (await this.client.query('COMMIT')),
      rollback: async () => void (await this.client.query('ROLLBACK'))
    }
  }

  async close(): Promise<void> {
    await this.closeOpenResult()
    await this.client.end().catch(() => undefined)
  }

  // Why: an open portal keeps its implicit transaction (and locks) alive until closed.
  private async closeOpenResult(): Promise<void> {
    const open = this.openResult
    this.openResult = null
    await open?.cursor.close().catch(() => undefined)
  }
}
