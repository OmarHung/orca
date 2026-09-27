import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseCell,
  DatabaseExecuteResult,
  DatabaseRowsPage,
  DatabaseTransactionMode
} from '../../../shared/database/database-query-types'
import { ConsoleTransactions } from './console-transactions'
import { introspectSqlite } from './sqlite-introspection'
import { encodeTextCell } from './database-cell-encoding'
import type { DatabaseDriverSession } from './database-driver'
import { commandRowCount, leadingKeyword } from './statement-keyword'
import type { DatabaseChangeTransaction } from './table-change-transaction'

type SqliteConnectionDraft = Extract<DatabaseConnectionDraft, { driver: 'sqlite' }>
type OpenResult = { resultId: string; rows: Iterator<unknown> }

const BUSY_TIMEOUT_MS = 5_000

function encodeValue(value: unknown): DatabaseCell {
  if (value instanceof Uint8Array) {
    return encodeTextCell(`0x${Buffer.from(value).toString('hex')}`)
  }
  return encodeTextCell(value)
}

function readPage(
  rows: Iterator<unknown>,
  pageSize: number
): { rows: DatabaseCell[][]; done: boolean } {
  const page: DatabaseCell[][] = []
  while (page.length < pageSize) {
    const next = rows.next()
    if (next.done) {
      return { rows: page, done: true }
    }
    page.push(Array.isArray(next.value) ? next.value.map(encodeValue) : [])
  }
  return { rows: page, done: false }
}

function openDatabase(connection: SqliteConnectionDraft): DatabaseSync {
  // Why: opening a mistyped path would silently create an empty database.
  if (!existsSync(connection.filePath)) {
    throw new Error(`SQLite file not found: ${connection.filePath}`)
  }
  const database = new DatabaseSync(connection.filePath, { readOnly: connection.readOnly })
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  return database
}

/** One console's connection; SQLite is synchronous, so a running statement blocks this worker. */
class SqliteConsole {
  private open: OpenResult | null = null
  readonly transactions = new ConsoleTransactions({
    state: async () => (this.database.isTransaction ? 'open' : 'none'),
    begin: async () => {
      this.closeOpen()
      this.database.exec('BEGIN')
    }
  })

  constructor(private readonly database: DatabaseSync) {}

  beginChanges(): DatabaseChangeTransaction {
    this.closeOpen()
    this.database.exec('BEGIN')
    return {
      run: async ({ sql, params }) => Number(this.database.prepare(sql).run(...params).changes),
      commit: async () => this.database.exec('COMMIT'),
      rollback: async () => this.database.exec('ROLLBACK')
    }
  }

  execute(sql: string, pageSize: number): DatabaseExecuteResult {
    this.closeOpen()
    const startedAt = performance.now()
    const statement: StatementSync = this.database.prepare(sql)
    statement.setReadBigInts(true)
    const columns = statement.columns()
    if (columns.length === 0) {
      const { changes } = statement.run()
      const durationMs = Math.round(performance.now() - startedAt)
      return {
        results: [
          {
            kind: 'command',
            command: leadingKeyword(sql),
            rowCount: commandRowCount(sql, Number(changes)),
            durationMs
          }
        ]
      }
    }
    statement.setReturnArrays(true)
    const rows = statement.iterate()
    const page = readPage(rows, pageSize)
    const resultId = randomUUID()
    if (!page.done) {
      this.open = { resultId, rows }
    }
    return {
      results: [
        {
          kind: 'rows',
          resultId,
          columns: columns.map((column) => ({ name: column.name, typeName: column.type ?? '' })),
          rows: page.rows,
          hasMore: !page.done,
          durationMs: Math.round(performance.now() - startedAt)
        }
      ]
    }
  }

  fetch(resultId: string, pageSize: number): DatabaseRowsPage {
    const open = this.open
    if (!open || open.resultId !== resultId) {
      throw new Error('This result is no longer open. Run the statement again to load more rows.')
    }
    const page = readPage(open.rows, pageSize)
    if (page.done) {
      this.open = null
    }
    return { rows: page.rows, hasMore: !page.done }
  }

  close(): void {
    this.closeOpen()
    this.database.close()
  }

  // Why: an unfinished iterator keeps the statement (and its read transaction) alive.
  private closeOpen(): void {
    this.open?.rows.return?.()
    this.open = null
  }
}

class SqliteSession implements DatabaseDriverSession {
  private readonly consoles = new Map<string, SqliteConsole>()

  constructor(
    private readonly connection: SqliteConnectionDraft,
    private readonly metaDatabase: DatabaseSync,
    readonly serverVersion: string
  ) {}

  async introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult> {
    return introspectSqlite(this.metaDatabase, target)
  }

  async execute(
    consoleId: string,
    sql: string,
    pageSize: number,
    mode: DatabaseTransactionMode
  ): Promise<DatabaseExecuteResult> {
    const target = this.console(consoleId)
    return target.transactions.run(mode, sql, async () => target.execute(sql, pageSize))
  }

  async beginChanges(consoleId: string): Promise<DatabaseChangeTransaction> {
    return this.console(consoleId).beginChanges()
  }

  async fetch(consoleId: string, resultId: string, pageSize: number): Promise<DatabaseRowsPage> {
    const target = this.consoles.get(consoleId)
    if (!target) {
      throw new Error('This result is no longer open. Run the statement again to load more rows.')
    }
    return target.fetch(resultId, pageSize)
  }

  // Why false: a synchronous statement can't be interrupted here; main restarts the worker instead.
  async cancel(): Promise<boolean> {
    return false
  }

  async closeConsole(consoleId: string): Promise<void> {
    this.consoles.get(consoleId)?.close()
    this.consoles.delete(consoleId)
  }

  async close(): Promise<void> {
    for (const target of this.consoles.values()) {
      target.close()
    }
    this.consoles.clear()
    this.metaDatabase.close()
  }

  private console(consoleId: string): SqliteConsole {
    let target = this.consoles.get(consoleId)
    if (!target) {
      target = new SqliteConsole(openDatabase(this.connection))
      this.consoles.set(consoleId, target)
    }
    return target
  }
}

export async function openSqliteSession(
  connection: SqliteConnectionDraft
): Promise<DatabaseDriverSession> {
  const metaDatabase = openDatabase(connection)
  const [row] = metaDatabase.prepare('select sqlite_version() as version').all()
  return new SqliteSession(connection, metaDatabase, String(row?.version ?? ''))
}
