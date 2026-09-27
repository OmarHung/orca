import { createReadStream } from 'node:fs'
import {
  DATABASE_SCRIPT_MAX_FAILURES,
  type DatabaseScriptFailure,
  type DatabaseScriptOptions,
  type DatabaseScriptProgress,
  type DatabaseScriptSummary
} from '../../../shared/database/database-script-types'
import type { DatabaseTransactionState } from '../../../shared/database/database-query-types'
import {
  SQL_SCRIPT_START,
  takeSqlScriptBatches,
  type SqlDialect,
  type SqlScriptTake
} from '../../../shared/database/sql-statement-splitter'

const CHUNK_BYTES = 1024 * 1024
// Why a cap: a SQL Server script without GO is one batch, held whole until its end.
const MAX_PENDING_CHARS = 64 * 1024 * 1024
const PROGRESS_INTERVAL_MS = 250
const STATEMENT_PREVIEW_CHARS = 200

export type SqlScriptFileSource = { path: string; name: string; size: number }

export type SqlScriptRun = {
  files: SqlScriptFileSource[]
  dialect: SqlDialect
  options: DatabaseScriptOptions
  /** Runs one batch on the script's session; resolves to its transaction state when known. */
  runStatement: (sql: string) => Promise<DatabaseTransactionState | undefined>
  describeError: (error: unknown) => { message: string; cancelled: boolean }
  onProgress: (progress: DatabaseScriptProgress) => void
  isCancelled: () => boolean
  chunkBytes?: number
  maxPendingChars?: number
}

/** A file the run could not go on reading; `line` is where its unread text starts. */
class ScriptFileError extends Error {
  constructor(
    message: string,
    readonly line: number
  ) {
    super(message)
  }
}

const BYTE_ORDER_MARK = 0xfeff

function countNewlines(text: string, from: number, to: number): number {
  let count = 0
  for (let index = text.indexOf('\n', from); index !== -1 && index < to;) {
    count += 1
    index = text.indexOf('\n', index + 1)
  }
  return count
}

/** Runs script files statement by statement, reading each as a stream. */
class SqlScriptExecution {
  private readonly startedAt = Date.now()
  private readonly totalBytes: number
  private readonly failures: DatabaseScriptFailure[] = []
  private statements = 0
  private failed = 0
  private stopped = false
  private transaction: DatabaseTransactionState = 'none'
  private bytesBefore = 0
  private lastReport = 0

  constructor(private readonly run: SqlScriptRun) {
    this.totalBytes = run.files.reduce((total, file) => total + file.size, 0)
  }

  async execute(): Promise<DatabaseScriptSummary> {
    for (const [index, file] of this.run.files.entries()) {
      if (this.stopped || this.run.isCancelled()) {
        break
      }
      try {
        await this.runFile(index, file)
      } catch (error) {
        const line = error instanceof ScriptFileError ? error.line : 0
        this.recordFailure(file.name, line, this.run.describeError(error).message, '')
        this.stopped ||= this.stopsOnError()
      }
      this.bytesBefore += file.size
    }
    const cancelled = this.run.isCancelled()
    const transaction = await this.endTransaction(cancelled)
    this.report(this.run.files.length - 1, this.bytesBefore, true)
    return {
      statements: this.statements,
      failed: this.failed,
      cancelled,
      durationMs: Date.now() - this.startedAt,
      failures: this.failures,
      failuresOmitted: this.failed - this.failures.length,
      transaction
    }
  }

  private async runFile(index: number, file: SqlScriptFileSource): Promise<void> {
    const stream = createReadStream(file.path, {
      encoding: 'utf8',
      highWaterMark: this.run.chunkBytes ?? CHUNK_BYTES
    })
    const state = { buffer: '', cursor: SQL_SCRIPT_START, line: 1 }
    const take = async (taken: SqlScriptTake): Promise<boolean> => {
      let line = state.line
      let counted = 0
      for (const statement of taken.statements) {
        if (this.stopped || this.run.isCancelled()) {
          return false
        }
        line += countNewlines(state.buffer, counted, statement.start)
        counted = statement.start
        await this.runOne(file, line, statement.text)
        // Why subtract: a small file is read whole at once, so what was read says nothing about
        // how far the run got; the text after this statement has not run yet.
        this.report(
          index,
          () =>
            this.bytesBefore +
            stream.bytesRead -
            Buffer.byteLength(state.buffer.slice(statement.terminatorEnd)),
          false
        )
      }
      state.line = line + countNewlines(state.buffer, counted, taken.consumed)
      state.buffer = state.buffer.slice(taken.consumed)
      state.cursor = taken.cursor
      return !this.stopped && !this.run.isCancelled()
    }
    try {
      let first = true
      for await (const chunk of stream) {
        const text = String(chunk)
        state.buffer += first && text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text
        first = false
        const going = await take(
          takeSqlScriptBatches(state.buffer, this.run.dialect, state.cursor, false)
        )
        if (!going) {
          return
        }
        if (state.buffer.length > (this.run.maxPendingChars ?? MAX_PENDING_CHARS)) {
          const pendingStart = Math.max(state.buffer.search(/\S/), 0)
          throw new ScriptFileError(
            'This statement is longer than 64 MB, so it was not run. Split it (e.g. with GO) and run the script again.',
            state.line + countNewlines(state.buffer, 0, pendingStart)
          )
        }
      }
      await take(takeSqlScriptBatches(state.buffer, this.run.dialect, state.cursor, true))
    } finally {
      stream.destroy()
    }
  }

  private async runOne(file: SqlScriptFileSource, line: number, sql: string): Promise<void> {
    try {
      this.transaction = (await this.run.runStatement(sql)) ?? this.transaction
      this.statements += 1
    } catch (error) {
      const described = this.run.describeError(error)
      if (described.cancelled && this.run.isCancelled()) {
        return
      }
      this.recordFailure(file.name, line, described.message, sql)
      this.stopped ||= this.stopsOnError()
    }
  }

  private async endTransaction(cancelled: boolean): Promise<DatabaseScriptSummary['transaction']> {
    if (this.transaction === 'none') {
      return null
    }
    const commit =
      this.run.options.transaction && !cancelled && !this.stopped && this.transaction === 'open'
    try {
      await this.run.runStatement(commit ? 'COMMIT' : 'ROLLBACK')
    } catch (error) {
      this.recordFailure(
        '',
        0,
        this.run.describeError(error).message,
        commit ? 'COMMIT' : 'ROLLBACK'
      )
      return null
    }
    return commit ? 'committed' : 'rolled-back'
  }

  // Why stop in a transaction: after an error PostgreSQL refuses the rest of it anyway.
  private stopsOnError(): boolean {
    return this.run.options.onError === 'stop' || this.run.options.transaction
  }

  private recordFailure(file: string, line: number, message: string, sql: string): void {
    this.failed += 1
    if (this.failures.length < DATABASE_SCRIPT_MAX_FAILURES) {
      this.failures.push({ file, line, message, statement: sql.slice(0, STATEMENT_PREVIEW_CHARS) })
    }
  }

  /** `bytesDone` is a function when working it out costs more than a throttled report. */
  private report(fileIndex: number, bytesDone: number | (() => number), force: boolean): void {
    const now = Date.now()
    if (!force && now - this.lastReport < PROGRESS_INTERVAL_MS) {
      return
    }
    const done = typeof bytesDone === 'number' ? bytesDone : bytesDone()
    this.lastReport = now
    this.run.onProgress({
      fileIndex: Math.max(fileIndex, 0),
      fileCount: this.run.files.length,
      fileName: this.run.files[Math.max(fileIndex, 0)]?.name ?? '',
      bytesDone: Math.min(Math.max(done, 0), this.totalBytes),
      totalBytes: this.totalBytes,
      statements: this.statements,
      failed: this.failed
    })
  }
}

export function runSqlScript(run: SqlScriptRun): Promise<DatabaseScriptSummary> {
  return new SqlScriptExecution(run).execute()
}
