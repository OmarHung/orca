import {
  DATABASE_LONG_VALUE_READ_MAX_CHARS,
  DATABASE_LONG_VALUE_READ_MAX_SLICES,
  type DatabaseCell,
  type DatabaseExecuteResult,
  type DatabaseLongValueSlice,
  type DatabaseQueryResult,
  type DatabaseRowsPage
} from '../../../shared/database/database-query-types'

/** Longer values ship as a preview; the grid shows the true length. */
export const DATABASE_CELL_PREVIEW_MAX_CHARS = 10_000

/** Full text kept of values shipped as previews, per worker; older results go first. */
export const DATABASE_LONG_VALUE_BUDGET_CHARS = 64 * 1024 * 1024

type KeptResult = { consoleId: string; values: Map<string, string>; chars: number }

const cellKey = (row: number, column: number): string => `${row}:${column}`

/**
 * Cuts values past the preview length out of the rows a worker sends, and keeps their full text
 * so copy and export can read it back in bounded slices. Rows are numbered from the start of
 * their result, across pages, so a cell's number names the same value the renderer holds.
 */
export class LongValueStore {
  /** Results with kept values, least recently used first. */
  private readonly results = new Map<string, KeptResult>()
  /** Per console, the one result that can still send pages, and its next row number. */
  private readonly open = new Map<string, { resultId: string; nextRow: number }>()
  private chars = 0

  constructor(private readonly budget = DATABASE_LONG_VALUE_BUDGET_CHARS) {}

  get keptChars(): number {
    return this.chars
  }

  /** The console's previous result can't send more pages once another statement runs. */
  startStatement(consoleId: string): void {
    this.open.delete(consoleId)
  }

  previewExecute(consoleId: string, result: DatabaseExecuteResult): DatabaseExecuteResult {
    return { ...result, results: this.previewResults(consoleId, result.results) }
  }

  previewPage(consoleId: string, resultId: string, page: DatabaseRowsPage): DatabaseRowsPage {
    const open = this.open.get(consoleId)
    const firstRow = open?.resultId === resultId ? open.nextRow : 0
    this.open.delete(consoleId)
    if (page.hasMore) {
      this.open.set(consoleId, { resultId, nextRow: firstRow + page.rows.length })
    }
    const rows = this.previewRows(consoleId, resultId, firstRow, page.rows)
    return page.followingResults
      ? { ...page, rows, followingResults: this.previewResults(consoleId, page.followingResults) }
      : { ...page, rows }
  }

  read(
    consoleId: string,
    resultId: string,
    slices: readonly DatabaseLongValueSlice[]
  ): (string | null)[] {
    const requested = slices.reduce((total, slice) => total + (slice.end - slice.start), 0)
    if (
      slices.length > DATABASE_LONG_VALUE_READ_MAX_SLICES ||
      requested > DATABASE_LONG_VALUE_READ_MAX_CHARS
    ) {
      throw new Error('Too much of a long value was asked for at once.')
    }
    const kept = this.results.get(resultId)
    if (!kept || kept.consoleId !== consoleId) {
      return slices.map(() => null)
    }
    this.touch(resultId, kept)
    return slices.map(
      (slice) =>
        kept.values.get(cellKey(slice.row, slice.column))?.slice(slice.start, slice.end) ?? null
    )
  }

  dropConsole(consoleId: string): void {
    this.open.delete(consoleId)
    for (const [resultId, kept] of this.results) {
      if (kept.consoleId === consoleId) {
        this.drop(resultId, kept)
      }
    }
  }

  clear(): void {
    this.open.clear()
    this.results.clear()
    this.chars = 0
  }

  private previewResults(
    consoleId: string,
    results: readonly DatabaseQueryResult[]
  ): DatabaseQueryResult[] {
    return results.map((result) => {
      if (result.kind !== 'rows') {
        return result
      }
      if (result.hasMore) {
        this.open.set(consoleId, { resultId: result.resultId, nextRow: result.rows.length })
      }
      return { ...result, rows: this.previewRows(consoleId, result.resultId, 0, result.rows) }
    })
  }

  private previewRows(
    consoleId: string,
    resultId: string,
    firstRow: number,
    rows: readonly DatabaseCell[][]
  ): DatabaseCell[][] {
    return rows.map((row, index) =>
      row.map((cell, column) => {
        if (typeof cell !== 'string' || cell.length <= DATABASE_CELL_PREVIEW_MAX_CHARS) {
          return cell
        }
        this.keep(consoleId, resultId, cellKey(firstRow + index, column), cell)
        return { preview: cell.slice(0, DATABASE_CELL_PREVIEW_MAX_CHARS), length: cell.length }
      })
    )
  }

  /** Keeps `text` if older results can make room; otherwise reading it reports it gone. */
  private keep(consoleId: string, resultId: string, key: string, text: string): void {
    // Why first: a value that can't fit even alone with its result mustn't evict the others.
    if ((this.results.get(resultId)?.chars ?? 0) + text.length > this.budget) {
      return
    }
    for (const [otherId, other] of this.results) {
      if (this.chars + text.length <= this.budget) {
        break
      }
      if (otherId !== resultId) {
        this.drop(otherId, other)
      }
    }
    if (this.chars + text.length > this.budget) {
      return
    }
    const kept = this.results.get(resultId) ?? { consoleId, values: new Map(), chars: 0 }
    kept.values.set(key, text)
    kept.chars += text.length
    this.chars += text.length
    this.touch(resultId, kept)
  }

  private touch(resultId: string, kept: KeptResult): void {
    this.results.delete(resultId)
    this.results.set(resultId, kept)
  }

  private drop(resultId: string, kept: KeptResult): void {
    this.results.delete(resultId)
    this.chars -= kept.chars
  }
}
