import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SqlDialect } from '../../../../shared/database/sql-dialect-lexing'

export type DumpStatement = {
  sql: string
  /** Its body holds `;` (a MySQL routine or trigger), so MySQL needs another delimiter. */
  compound?: boolean
}

/** A statement as the dialect's own tools read a script: `;`, `GO` batches, DELIMITER. */
export function formatStatement(dialect: SqlDialect, statement: DumpStatement): string {
  const sql = statement.sql.trim().replace(/;\s*$/, '')
  switch (dialect) {
    case 'sqlserver':
      return `${sql}\nGO\n`
    case 'mysql':
      return statement.compound ? `DELIMITER ;;\n${sql};;\nDELIMITER ;\n` : `${sql};\n`
    case 'postgres':
    case 'sqlite':
      return `${sql};\n`
  }
}

export function insertStatement(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  options: { overridingSystemValue?: boolean } = {}
): string {
  const override = options.overridingSystemValue ? ' OVERRIDING SYSTEM VALUE' : ''
  const values = rows.map((row) => `(${row.join(', ')})`).join(',\n')
  return `INSERT INTO ${table} (${columns.join(', ')})${override} VALUES\n${values}`
}

/** Characters no file name may hold on some platform; a table name can hold any of them. */
export function safeFileName(name: string): string {
  return [...name]
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
    .join('')
    .slice(0, 120)
}

export type DumpDestination = { kind: 'file'; path: string } | { kind: 'folder'; path: string }

/**
 * Where a dump is written: one file, or a folder of numbered files (one per table). Writes
 * wait for the stream to drain, so a slow disk slows the reads instead of filling memory.
 */
export class DumpOutput {
  private stream: WriteStream | null = null
  private readonly written: string[] = []
  bytes = 0

  constructor(
    private readonly destination: DumpDestination,
    readonly dialect: SqlDialect
  ) {}

  get files(): readonly string[] {
    return this.written
  }

  /** Starts the next file of a folder dump; a single-file dump opens its only file once. */
  async startFile(name: string): Promise<void> {
    if (this.destination.kind === 'file') {
      if (!this.stream) {
        await this.open(this.destination.path)
      }
      return
    }
    await this.closeCurrent()
    await mkdir(this.destination.path, { recursive: true })
    await this.open(join(this.destination.path, name))
  }

  async comment(text: string): Promise<void> {
    await this.write(`${text.replace(/^/gm, '-- ')}\n`)
  }

  async statement(statement: DumpStatement): Promise<void> {
    await this.write(formatStatement(this.dialect, statement))
  }

  async blankLine(): Promise<void> {
    await this.write('\n')
  }

  /** Text as it is, e.g. a native tool's output passed through. */
  async raw(chunk: string | Buffer): Promise<void> {
    await this.write(chunk)
  }

  async finish(): Promise<string[]> {
    await this.closeCurrent()
    return [...this.written]
  }

  /** Removes what was written, e.g. after a cancel, so no half dump is left looking whole. */
  async discard(): Promise<void> {
    await this.closeCurrent().catch(() => undefined)
    await Promise.all(this.written.map((path) => rm(path, { force: true })))
  }

  private async open(path: string): Promise<void> {
    const stream = createWriteStream(path, { encoding: 'utf8' })
    await new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve())
      stream.once('error', reject)
    })
    this.stream = stream
    this.written.push(path)
  }

  private async write(text: string | Buffer): Promise<void> {
    const stream = this.stream
    if (!stream) {
      throw new Error('The dump has no open file.')
    }
    this.bytes += typeof text === 'string' ? Buffer.byteLength(text) : text.length
    if (!stream.write(text)) {
      await new Promise<void>((resolve, reject) => {
        stream.once('drain', resolve)
        stream.once('error', reject)
      })
    }
  }

  private async closeCurrent(): Promise<void> {
    const stream = this.stream
    this.stream = null
    if (stream) {
      await new Promise<void>((resolve, reject) => {
        stream.end((error?: Error | null) => (error ? reject(error) : resolve()))
      })
    }
  }
}
