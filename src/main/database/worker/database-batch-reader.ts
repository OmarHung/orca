import { randomUUID } from 'node:crypto'
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseExecuteResult,
  DatabaseQueryResult,
  DatabaseRowsPage,
  DatabaseRowsResult
} from '../../../shared/database/database-query-types'

export type BatchFlowControl = { pause: () => void; resume: () => void }

type ResultSet = { resultId: string; columns: DatabaseColumn[]; rows: DatabaseCell[][] }

/**
 * Turns a driver's streamed result sets (MySQL, SQL Server) into page-at-a-time results:
 * the flow pauses whenever the current set fills a page, and result sets that follow a
 * paged one are delivered with the page that finishes it.
 */
export class PagedBatchReader {
  private readonly startedAt = performance.now()
  /** Finished results not yet handed to the caller. */
  private ready: DatabaseQueryResult[] = []
  private current: ResultSet | null = null
  /** The set whose first page was handed off and that `nextPage` continues. */
  private paged: ResultSet | null = null
  /** Rows of `paged` that arrived after it ended; null while it is still open. */
  private pagedTail: DatabaseCell[][] | null = null
  private pageLimit: number
  private paused = false
  private finished = false
  private failure: { error: unknown } | null = null
  private producedRowSet = false
  private discarding = false
  private wake: (() => void) | null = null

  constructor(
    private readonly flow: BatchFlowControl,
    pageSize: number
  ) {
    this.pageLimit = pageSize
  }

  get isOpen(): boolean {
    return !this.finished
  }

  get pagedResultId(): string | null {
    return this.paged?.resultId ?? null
  }

  get hasOpenResultSet(): boolean {
    return this.current !== null
  }

  /** True once any result set started; MySQL ends CALLs with an OK packet worth skipping. */
  get hasProducedRows(): boolean {
    return this.producedRowSet
  }

  startResultSet(columns: DatabaseColumn[]): void {
    this.endResultSet()
    this.current = { resultId: randomUUID(), columns, rows: [] }
    this.producedRowSet = true
  }

  addRow(cells: DatabaseCell[]): void {
    const set = this.current
    if (this.discarding || !set) {
      return
    }
    set.rows.push(cells)
    if (set.rows.length >= this.pageLimit) {
      this.paused = true
      this.flow.pause()
      this.notify()
    }
  }

  endResultSet(): void {
    const set = this.current
    this.current = null
    if (!set || this.discarding) {
      return
    }
    if (set === this.paged) {
      this.pagedTail = set.rows
      return
    }
    this.ready.push(this.rowsResult(set, false))
  }

  addCommand(command: string, rowCount: number | null): void {
    this.endResultSet()
    if (this.discarding) {
      return
    }
    this.ready.push({ kind: 'command', command, rowCount, durationMs: this.elapsed() })
  }

  finish(): void {
    this.endResultSet()
    this.finished = true
    this.notify()
  }

  fail(error: unknown): void {
    this.current = null
    this.failure = { error }
    this.finished = true
    this.notify()
  }

  async firstPage(): Promise<DatabaseExecuteResult> {
    await this.settled()
    this.throwIfFailed()
    const results = this.takeReady()
    if (this.paused && this.current) {
      results.push(this.handOff(this.current))
    }
    if (results.length === 0) {
      results.push({ kind: 'command', command: '', rowCount: null, durationMs: this.elapsed() })
    }
    return { results }
  }

  async nextPage(pageSize: number): Promise<DatabaseRowsPage> {
    const paged = this.paged
    if (!paged || !this.paused || this.pagedTail) {
      throw new Error('This result is no longer open. Run the statement again to load more rows.')
    }
    this.pageLimit = pageSize
    this.paused = false
    this.flow.resume()
    await this.settled()
    this.throwIfFailed()
    if (!this.pagedTail && this.current === paged) {
      const rows = paged.rows
      paged.rows = []
      return { rows, hasMore: true }
    }
    const rows = this.pagedTail ?? []
    this.paged = null
    this.pagedTail = null
    const followingResults = this.takeReady()
    if (this.paused && this.current) {
      followingResults.push(this.handOff(this.current))
    }
    return { rows, hasMore: false, followingResults }
  }

  /** Stops collecting and lets the driver drain; call after asking the server to cancel. */
  async abandon(): Promise<void> {
    this.discarding = true
    this.current = null
    this.ready = []
    if (this.paused) {
      this.paused = false
      this.flow.resume()
    }
    while (!this.finished) {
      await new Promise<void>((resolve) => (this.wake = resolve))
    }
  }

  private handOff(set: ResultSet): DatabaseRowsResult {
    const result = this.rowsResult(set, true)
    set.rows = []
    this.paged = set
    this.pagedTail = null
    return result
  }

  private rowsResult(set: ResultSet, hasMore: boolean): DatabaseRowsResult {
    return {
      kind: 'rows',
      resultId: set.resultId,
      columns: set.columns,
      rows: set.rows,
      hasMore,
      durationMs: this.elapsed()
    }
  }

  private takeReady(): DatabaseQueryResult[] {
    const ready = this.ready
    this.ready = []
    return ready
  }

  private async settled(): Promise<void> {
    while (!this.paused && !this.finished) {
      await new Promise<void>((resolve) => (this.wake = resolve))
    }
  }

  private notify(): void {
    const wake = this.wake
    this.wake = null
    wake?.()
  }

  private throwIfFailed(): void {
    if (this.failure) {
      throw this.failure.error
    }
  }

  private elapsed(): number {
    return Math.round(performance.now() - this.startedAt)
  }
}
