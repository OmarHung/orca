import { Request, type Connection } from 'tedious'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import { PagedBatchReader } from './database-batch-reader'
import { assertReadOnlySql } from './read-only-sql-guard'
import { closeSqlServer } from './sqlserver-client-factory'
import {
  encodeSqlServerValue,
  sqlServerTypeName,
  type SqlServerColumnMeta
} from './sqlserver-values'
import { leadingKeyword } from './statement-keyword'

type RowValue = { value: unknown; metadata: SqlServerColumnMeta }

function columnList(
  columns: SqlServerColumnMeta[] | Record<string, SqlServerColumnMeta>
): SqlServerColumnMeta[] {
  return Array.isArray(columns) ? columns : Object.values(columns)
}

/** One console's TDS session; a batch stays open (paused) until its rows are read or dropped. */
export class SqlServerConsole {
  private reader: PagedBatchReader | null = null

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

  cancel(): boolean {
    return this.client.cancel()
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
