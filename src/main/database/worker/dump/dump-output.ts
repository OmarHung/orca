import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream, existsSync, type WriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { SqlDialect } from '../../../../shared/database/sql-dialect-lexing'
import { bestEffortFsyncDirectorySync, fsyncFileSync } from '../../../../shared/secure-file'

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
 * Where a dump is written until it is whole: a hidden sibling of the file or folder it becomes,
 * named so it never looks like a finished .sql. Main derives the same path from the job id to
 * clean up after a worker that died mid-dump.
 */
export function partialDumpPath(destination: DumpDestination, id: string): string {
  return join(dirname(destination.path), `.${basename(destination.path)}.${id}.partial`)
}

/**
 * A dump's output: one file, or a folder of numbered files (one per table). Everything goes to
 * the partial path first and replaces the destination only once finished, so a failed or
 * cancelled dump (or a crash) leaves an existing file as it was. Writes wait for the stream to
 * drain, so a slow disk slows the reads instead of filling memory.
 */
export class DumpOutput {
  private stream: WriteStream | null = null
  /** The first write error, kept by one listener so waits don't each add their own. */
  private failure: Error | null = null
  private readonly names: string[] = []
  private readonly partial: string
  private published = false
  bytes = 0

  constructor(
    private readonly destination: DumpDestination,
    readonly dialect: SqlDialect,
    id: string = randomUUID()
  ) {
    this.partial = partialDumpPath(destination, id)
  }

  /** Starts the next file of a folder dump; a single-file dump opens its only file once. */
  async startFile(name: string): Promise<void> {
    if (this.destination.kind === 'file') {
      if (!this.stream) {
        await this.open(this.partial)
      }
      return
    }
    await this.closeCurrent()
    await mkdir(this.partial, { recursive: true })
    await this.open(join(this.partial, name))
    this.names.push(name)
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

  /** Flushes the dump to disk and puts it in place of the destination; returns its files. */
  async finish(): Promise<string[]> {
    await this.closeCurrent()
    const { path } = this.destination
    if (this.destination.kind === 'file') {
      if (!existsSync(this.partial)) {
        await this.open(this.partial)
        await this.closeCurrent()
      }
      // Why sync first: after a crash the renamed file must hold everything it claims to.
      fsyncFileSync(this.partial)
      await rename(this.partial, path)
      this.published = true
      bestEffortFsyncDirectorySync(dirname(path))
      return [path]
    }
    await mkdir(this.partial, { recursive: true })
    for (const name of this.names) {
      fsyncFileSync(join(this.partial, name))
    }
    bestEffortFsyncDirectorySync(this.partial)
    if (existsSync(path)) {
      throw new Error(`${path} already exists; choose the folder again.`)
    }
    await rename(this.partial, path)
    this.published = true
    bestEffortFsyncDirectorySync(dirname(path))
    return this.names.map((name) => join(path, name))
  }

  /** Removes what was written, e.g. after a cancel; a finished dump stays where it was put. */
  async discard(): Promise<void> {
    const stream = this.stream
    this.stream = null
    if (stream && !stream.closed) {
      stream.destroy()
      await once(stream, 'close').catch(() => undefined)
    }
    if (!this.published) {
      // Best effort: a discard follows a failure, whose error must not be replaced by this one.
      await rm(this.partial, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async open(path: string): Promise<void> {
    const stream = createWriteStream(path)
    stream.on('error', (error) => {
      this.failure ??= error
    })
    await once(stream, 'open')
    this.stream = stream
  }

  private async write(chunk: string | Buffer): Promise<void> {
    const stream = this.stream
    if (this.failure) {
      throw this.failure
    }
    if (!stream) {
      throw new Error('The dump has no open file.')
    }
    this.bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    if (!stream.write(chunk)) {
      // Why events.once: it removes both its drain and error listeners, whichever fires.
      await once(stream, 'drain')
    }
  }

  private async closeCurrent(): Promise<void> {
    const stream = this.stream
    this.stream = null
    // Why destroy a failed stream: it will never emit 'finish' to wait for.
    if (stream && this.failure) {
      stream.destroy()
    } else if (stream) {
      stream.end()
      await once(stream, 'finish')
    }
    if (this.failure) {
      throw this.failure
    }
  }
}
