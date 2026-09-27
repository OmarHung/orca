import type mysql from 'mysql2'
import type { FieldPacket } from 'mysql2'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import { ConsoleTransactions } from './console-transactions'
import { PagedBatchReader } from './database-batch-reader'
import { endMysqlClient } from './mysql-client-factory'
import { encodeMysqlRow, mysqlColumns } from './mysql-values'
import { commandRowCount, leadingKeyword } from './statement-keyword'
import type { DatabaseChangeTransaction } from './table-change-transaction'

// SERVER_STATUS_IN_TRANS in the OK packet's status flags.
const IN_TRANSACTION_FLAG = 1

function headerNumber(header: unknown, key: string): number | null {
  const value: unknown =
    typeof header === 'object' && header !== null ? Reflect.get(header, key) : null
  return typeof value === 'number' ? value : null
}

function affectedRows(header: unknown): number | null {
  return headerNumber(header, 'affectedRows')
}

/** One console's MySQL session; its latest statement stays open (flow paused) until fully read. */
export class MysqlConsole {
  private reader: PagedBatchReader | null = null
  readonly transactions = new ConsoleTransactions({
    // Why DO 0: it changes nothing, and its OK packet carries the session's status flags.
    state: async () =>
      ((await this.statusFlags('DO 0')) & IN_TRANSACTION_FLAG) === 0 ? 'none' : 'open',
    setManual: async (manual) => {
      await this.abandonOpen()
      await this.control(`SET autocommit = ${manual ? 0 : 1}`)
    }
  })

  constructor(
    readonly client: mysql.Connection,
    private readonly killQuery: (threadId: number) => Promise<void>
  ) {}

  async execute(sql: string, pageSize: number): Promise<DatabaseExecuteResult> {
    await this.abandonOpen()
    const client = this.client
    const reader = new PagedBatchReader(
      { pause: () => client.pause(), resume: () => client.resume() },
      pageSize
    )
    this.reader = reader
    let fields: FieldPacket[] = []
    const query = client.query({ sql, rowsAsArray: true })
    query.on('fields', (next: FieldPacket[] | undefined) => {
      // Why the guard: statements without a result set still emit `fields`, with no payload.
      if (!next) {
        return
      }
      fields = next
      reader.startResultSet(mysqlColumns(next))
    })
    query.on('result', (row: unknown) => {
      if (Array.isArray(row)) {
        reader.addRow(encodeMysqlRow(row, fields))
      } else if (!reader.hasProducedRows) {
        // Why the guard: a CALL ends with an OK packet after its result sets; that one is noise.
        reader.addCommand(leadingKeyword(sql), commandRowCount(sql, affectedRows(row)))
      }
    })
    query.on('error', (error: Error) => reader.fail(error))
    query.on('end', () => reader.finish())
    try {
      return await reader.firstPage()
    } finally {
      this.releaseIfDone(reader)
    }
  }

  async fetch(resultId: string, pageSize: number): Promise<DatabaseRowsPage> {
    const reader = this.reader
    if (!reader || reader.pagedResultId !== resultId) {
      throw new Error('This result is no longer open. Run the statement again to load more rows.')
    }
    try {
      return await reader.nextPage(pageSize)
    } finally {
      this.releaseIfDone(reader)
    }
  }

  async beginChanges(): Promise<DatabaseChangeTransaction> {
    await this.abandonOpen()
    await this.control('START TRANSACTION')
    return {
      // Why execute: server-side prepared statements bind every value.
      run: ({ sql, params }) =>
        new Promise((resolve, reject) => {
          this.client.execute(sql, params, (error, result) =>
            error ? reject(error) : resolve(affectedRows(result) ?? 0)
          )
        }),
      commit: () => this.control('COMMIT'),
      rollback: () => this.control('ROLLBACK')
    }
  }

  async close(): Promise<void> {
    await this.abandonOpen()
    await endMysqlClient(this.client)
  }

  private control(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.query(sql, (error) => (error ? reject(error) : resolve()))
    })
  }

  private statusFlags(sql: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.client.query(sql, (error, result) =>
        error ? reject(error) : resolve(headerNumber(result, 'serverStatus') ?? 0)
      )
    })
  }

  private releaseIfDone(reader: PagedBatchReader): void {
    if (!reader.isOpen && this.reader === reader) {
      this.reader = null
    }
  }

  // Why kill first: resuming alone would stream the rest of a huge result just to drop it.
  private async abandonOpen(): Promise<void> {
    const reader = this.reader
    this.reader = null
    if (reader?.isOpen) {
      await this.killQuery(this.client.threadId).catch(() => undefined)
      await reader.abandon()
    }
  }
}
