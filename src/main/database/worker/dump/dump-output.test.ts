import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DumpOutput,
  formatStatement,
  insertStatement,
  partialDumpPath,
  safeFileName
} from './dump-output'

const dir = mkdtempSync(join(tmpdir(), 'orca-dump-output-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('formatStatement', () => {
  it('ends statements the way each dialect’s tools read a script', () => {
    expect(formatStatement('postgres', { sql: 'select 1;' })).toBe('select 1;\n')
    expect(formatStatement('sqlite', { sql: 'create trigger t begin select 1; end' })).toBe(
      'create trigger t begin select 1; end;\n'
    )
    expect(formatStatement('sqlserver', { sql: 'create view v as select 1' })).toBe(
      'create view v as select 1\nGO\n'
    )
    expect(
      formatStatement('mysql', { sql: 'create procedure p() begin select 1; end', compound: true })
    ).toBe('DELIMITER ;;\ncreate procedure p() begin select 1; end;;\nDELIMITER ;\n')
    expect(formatStatement('mysql', { sql: 'set names utf8mb4' })).toBe('set names utf8mb4;\n')
  })
})

describe('insertStatement', () => {
  it('writes several rows in one INSERT, overriding identity when asked', () => {
    expect(
      insertStatement(
        't',
        ['a', 'b'],
        [
          ['1', "'x'"],
          ['2', 'NULL']
        ]
      )
    ).toBe("INSERT INTO t (a, b) VALUES\n(1, 'x'),\n(2, NULL)")
    expect(insertStatement('t', ['id'], [['1']], { overridingSystemValue: true })).toBe(
      'INSERT INTO t (id) OVERRIDING SYSTEM VALUE VALUES\n(1)'
    )
  })
})

describe('DumpOutput', () => {
  it('writes one file, counting bytes', async () => {
    const path = join(dir, 'one.sql')
    const output = new DumpOutput({ kind: 'file', path }, 'postgres')
    await output.startFile('ignored.sql')
    await output.comment('header\nsecond line')
    await output.statement({ sql: 'select 1' })
    await output.startFile('still-one.sql')
    await output.statement({ sql: 'select 2' })
    expect(await output.finish()).toEqual([path])
    const text = readFileSync(path, 'utf8')
    expect(text).toBe('-- header\n-- second line\nselect 1;\nselect 2;\n')
    expect(output.bytes).toBe(Buffer.byteLength(text))
  })

  it('builds a folder of files out of sight, and puts it in place only when finished', async () => {
    const folder = join(dir, 'per-table')
    const output = new DumpOutput({ kind: 'folder', path: folder }, 'sqlserver', 'job-folder')
    await output.startFile('000_setup.sql')
    await output.statement({ sql: 'set nocount on' })
    await output.startFile('001_dbo.items.sql')
    await output.statement({ sql: 'select 1' })
    expect(existsSync(folder)).toBe(false)
    expect(readdirSync(partialDumpPath({ kind: 'folder', path: folder }, 'job-folder'))).toEqual([
      '000_setup.sql',
      '001_dbo.items.sql'
    ])
    const files = await output.finish()
    expect(files).toEqual([join(folder, '000_setup.sql'), join(folder, '001_dbo.items.sql')])
    expect(readFileSync(files[1]!, 'utf8')).toBe('select 1\nGO\n')
    // A finished dump is the user's now; discarding afterwards leaves it.
    await output.discard()
    expect(files.every((file) => existsSync(file))).toBe(true)
    expect(readdirSync(dir).filter((name) => name.endsWith('.partial'))).toEqual([])
  })

  it('replaces an existing file only once the new dump is whole', async () => {
    const path = join(dir, 'replaced.sql')
    writeFileSync(path, 'the earlier dump\n')
    const output = new DumpOutput({ kind: 'file', path }, 'postgres', 'job-replace')
    await output.startFile('ignored.sql')
    await output.statement({ sql: 'select 1' })
    // Until then, the file is untouched and the new one is a hidden .partial, never a .sql.
    const partial = partialDumpPath({ kind: 'file', path }, 'job-replace')
    expect(partial).toBe(join(dir, '.replaced.sql.job-replace.partial'))
    expect(readFileSync(path, 'utf8')).toBe('the earlier dump\n')
    // Only its existence: what the stream accepted may not be on disk until it is finished.
    expect(existsSync(partial)).toBe(true)
    expect(await output.finish()).toEqual([path])
    expect(readFileSync(path, 'utf8')).toBe('select 1;\n')
    expect(existsSync(partial)).toBe(false)
  })

  it('keeps an existing file whole when the dump is discarded or its output fails', async () => {
    const path = join(dir, 'kept.sql')
    writeFileSync(path, 'the earlier dump\n')
    const cancelled = new DumpOutput({ kind: 'file', path }, 'postgres')
    await cancelled.startFile('ignored.sql')
    await cancelled.statement({ sql: 'select 1' })
    await cancelled.discard()
    expect(readFileSync(path, 'utf8')).toBe('the earlier dump\n')

    // The output can't be written (its folder is a file), so the dump fails before replacing.
    const blocked = join(dir, 'blocked')
    writeFileSync(blocked, '')
    const failing = new DumpOutput({ kind: 'file', path: join(blocked, 'x.sql') }, 'postgres')
    await expect(failing.startFile('ignored.sql')).rejects.toThrow()
    await failing.discard()
    expect(readdirSync(dir).filter((name) => name.endsWith('.partial'))).toEqual([])
    expect(readFileSync(path, 'utf8')).toBe('the earlier dump\n')
  })

  it('refuses to put a folder dump over a folder that appeared meanwhile', async () => {
    const folder = join(dir, 'taken')
    const output = new DumpOutput({ kind: 'folder', path: folder }, 'mysql')
    await output.startFile('000_setup.sql')
    mkdirSync(folder)
    writeFileSync(join(folder, 'mine.txt'), 'x')
    await expect(output.finish()).rejects.toThrow(/already exists/)
    await output.discard()
    expect(readdirSync(folder)).toEqual(['mine.txt'])
  })

  it('waits out backpressure again and again without piling up listeners', async () => {
    const warnings: Error[] = []
    const onWarning = (warning: Error): void => {
      warnings.push(warning)
    }
    process.on('warning', onWarning)
    try {
      const path = join(dir, 'large.sql')
      const output = new DumpOutput({ kind: 'file', path }, 'mysql')
      await output.startFile('ignored.sql')
      // Each 64 KiB chunk fills the stream's 16 KiB buffer, so every write waits for drain.
      const chunk = Buffer.alloc(64 * 1024, 'x')
      for (let index = 0; index < 200; index += 1) {
        await output.raw(chunk)
      }
      await output.finish()
      await new Promise((resolve) => setImmediate(resolve))
      expect(readFileSync(path).length).toBe(200 * chunk.length)
    } finally {
      process.off('warning', onWarning)
    }
    expect(warnings.filter((warning) => warning.name === 'MaxListenersExceededWarning')).toEqual([])
  })

  it('makes any table name a safe file name', () => {
    expect(safeFileName('a/b:c*"d"<e>|f?\\g')).toBe('a_b_c__d__e__f__g')
  })
})
