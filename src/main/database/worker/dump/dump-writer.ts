import type { DatabaseDumpProgress } from '../../../../shared/database/database-dump-types'
import { safeFileName, type DumpOutput, type DumpStatement } from './dump-output'
import type { DumpSource } from './dump-source'

const PROGRESS_INTERVAL_MS = 250

export class DumpCancelled extends Error {
  constructor() {
    super('The dump was cancelled.')
  }
}

export type DumpSettings = { before: DumpStatement[]; after: DumpStatement[] }

/**
 * The dump's files as it writes them: numbered names, the session settings each file starts
 * and ends with, the schema unqualified names resolve in, and progress.
 */
export class DumpWriter {
  readonly progress: DatabaseDumpProgress
  private lastReport = 0
  private currentSchema: string | null = null
  private settingsAfter: DumpStatement[] = []
  private fileIndex = 0
  private readonly width: number

  constructor(
    private readonly source: DumpSource,
    private readonly output: DumpOutput,
    private readonly options: {
      perTable: boolean
      tableCount: number
      schemaCount: number
      onProgress: (progress: DatabaseDumpProgress) => void
      isCancelled: () => boolean
    }
  ) {
    // Setup, one file per table, finish.
    this.width = Math.max(3, String(options.tableCount + 2).length)
    this.progress = {
      tablesDone: 0,
      tableCount: options.tableCount,
      currentTable: null,
      rows: 0,
      bytes: 0
    }
  }

  /** Starts the next file (or, for one file, begins it), with the settings it needs. */
  async startFile(label: string, settings: DumpSettings): Promise<void> {
    const name = `${String(this.fileIndex).padStart(this.width, '0')}_${safeFileName(label)}.sql`
    const first = this.fileIndex === 0
    this.fileIndex += 1
    if (!first && !this.options.perTable) {
      return
    }
    if (!first) {
      await this.statements(this.settingsAfter)
    }
    await this.output.startFile(name)
    await this.output.comment(`Written by Orca, ${new Date().toISOString()}`)
    await this.statements(settings.before)
    this.settingsAfter = settings.after
    this.currentSchema = null
  }

  async section(title: string): Promise<void> {
    await this.output.blankLine()
    await this.output.comment(title)
  }

  /** Makes `schema` the one unqualified names resolve in, where the dialect needs it. */
  async enter(schema: string): Promise<void> {
    if (this.currentSchema !== schema) {
      this.currentSchema = schema
      await this.statements(this.source.enterSchema(schema, this.options.schemaCount))
    }
  }

  async statements(statements: readonly DumpStatement[]): Promise<void> {
    for (const statement of statements) {
      await this.output.statement(statement)
    }
  }

  async finish(): Promise<string[]> {
    await this.statements(this.settingsAfter)
    const files = await this.output.finish()
    this.report(true)
    return files
  }

  checkCancelled(): void {
    if (this.options.isCancelled()) {
      this.source.cancel()
      throw new DumpCancelled()
    }
  }

  report(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.lastReport < PROGRESS_INTERVAL_MS) {
      return
    }
    this.lastReport = now
    this.options.onProgress({ ...this.progress, bytes: this.output.bytes })
  }
}
