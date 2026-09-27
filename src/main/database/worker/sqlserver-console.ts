import { Request, TYPES, type Connection } from 'tedious'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import { quoteSqlName } from '../../../shared/database/sql-identifiers'
import { ConsoleSchema } from './console-schema'
import { ConsoleTransactions } from './console-transactions'
import { PagedBatchReader } from './database-batch-reader'
import { assertReadOnlySql } from './read-only-sql-guard'
import { closeSqlServer, querySqlServerRows } from './sqlserver-client-factory'
import {
  encodeSqlServerValue,
  sqlServerTypeName,
  type SqlServerColumnMeta
} from './sqlserver-values'
import { leadingKeyword } from './statement-keyword'
import type { DatabaseChangeTransaction } from './table-change-transaction'

type RowValue = { value: unknown; metadata: SqlServerColumnMeta }

function columnList(
  columns: SqlServerColumnMeta[] | Record<string, SqlServerColumnMeta>
): SqlServerColumnMeta[] {
  return Array.isArray(columns) ? columns : Object.values(columns)
}

/** One console's TDS session; a batch stays open (paused) until its rows are read or dropped. */
export class SqlServerConsole {
  private reader: PagedBatchReader | null = null
  readonly transactions = new ConsoleTransactions({
    // XACT_STATE is -1 for a transaction an error left uncommittable.
    state: async () => {
      const [row] = await querySqlServerRows(this.client, 'select xact_state() as state')
      const state = Number(row?.state)
      return state === 1 ? 'open' : state === -1 ? 'failed' : 'none'
    },
    setManual: async (manual) => {
      await this.abandonOpen()
      await this.batch(`SET IMPLICIT_TRANSACTIONS ${manual ? 'ON' : 'OFF'}`)
    }
  })

  // SQL Server consoles switch database, not schema: the user's default schema applies in each.
  readonly database = new ConsoleSchema({
    apply: async (name) => {
      await this.abandonOpen()
      await this.batch(`USE ${quoteSqlName(name, 'sqlserver')}`)
    },
    current: async () => {
      const [row] = await querySqlServerRows(this.client, 'select db_name() as name')
      return typeof row?.name === 'string' ? row.name : null
    },
    mayChange: (sql) => leadingKeyword(sql) === 'USE'
  })

  constructor(
    readonly client: Connection,
    private readonly readOnly: boolean
  ) {}

  async execute(sql: string, pageSize: number): Promise<DatabaseExecuteResult> {
    await this.abandonOpen()
    if (this.readOnly) {
      assertReadOnlySql(sql, 'sqlserver')
    }
    let reader: PagedBatchReader | null = null
    // Why a sum: DECLARE/SET report "1 row" exactly like DML does, so per-statement counts
    // mislead; a batch without result sets reports its total, like SSMS's last message.
    let affected: number | null = null
    const request = new Request(sql, (error) => {
      if (error) {
        reader?.fail(error)
        return
      }
      // Why also without a count: DDL reports none, and should still be named (CREATE, DROP…).
      if (!reader?.hasProducedRows) {
        reader?.addCommand(leadingKeyword(sql), affected)
      }
      reader?.finish()
    })
    reader = new PagedBatchReader(
      { pause: () => request.pause(), resume: () => request.resume() },
      pageSize
    )
    const batch = reader
    this.reader = batch
    request.on('columnMetadata', (columns) => {
      batch.startResultSet(
        columnList(columns).map((meta) => ({
          name: meta.colName,
          typeName: sqlServerTypeName(meta)
        }))
      )
    })
    request.on('row', (columns: RowValue[]) => {
      batch.addRow(columns.map((column) => encodeSqlServerValue(column.value, column.metadata)))
    })
    // `done` ends each statement of a batch; `doneInProc` does the same inside procedures.
    const onStatementDone = (rowCount: number | undefined): void => {
      if (batch.hasOpenResultSet) {
        batch.endResultSet()
      } else if (rowCount !== undefined) {
        affected = (affected ?? 0) + rowCount
      }
    }
    request.on('done', onStatementDone)
    request.on('doneInProc', onStatementDone)
    // Why a batch, not execSql: sp_executesql would scope DECLAREs and reject GO-free scripts.
    this.client.execSqlBatch(request)
    try {
      return await batch.firstPage()
    } finally {
      this.releaseIfDone(batch)
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
    await this.batch('BEGIN TRANSACTION')
    return {
      // Why NVarChar: the server converts it to each column's type, as it would a literal.
      run: ({ sql, params }) =>
        new Promise((resolve, reject) => {
          const request = new Request(sql, (error, rowCount) =>
            error ? reject(error) : resolve(rowCount ?? 0)
          )
          params.forEach((value, index) =>
            request.addParameter(`p${index + 1}`, TYPES.NVarChar, value)
          )
          this.client.execSql(request)
        }),
      commit: () => this.batch('COMMIT TRANSACTION'),
      rollback: () => this.batch('IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION')
    }
  }

  cancel(): boolean {
    return this.client.cancel()
  }

  private batch(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.execSqlBatch(new Request(sql, (error) => (error ? reject(error) : resolve())))
    })
  }

  async close(): Promise<void> {
    await this.abandonOpen()
    await closeSqlServer(this.client)
  }

  private releaseIfDone(reader: PagedBatchReader): void {
    if (!reader.isOpen && this.reader === reader) {
      this.reader = null
    }
  }

  private async abandonOpen(): Promise<void> {
    const reader = this.reader
    this.reader = null
    if (reader?.isOpen) {
      this.client.cancel()
      await reader.abandon()
    }
  }
}
