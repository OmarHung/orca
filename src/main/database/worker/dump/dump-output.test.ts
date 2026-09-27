import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DumpOutput, formatStatement, insertStatement, safeFileName } from './dump-output'

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

  it('writes a folder of files, and removes them all when discarded', async () => {
    const folder = join(dir, 'per-table')
    const output = new DumpOutput({ kind: 'folder', path: folder }, 'sqlserver')
    await output.startFile('000_setup.sql')
    await output.statement({ sql: 'set nocount on' })
    await output.startFile('001_dbo.items.sql')
    await output.statement({ sql: 'select 1' })
    const files = await output.finish()
    expect(files).toEqual([join(folder, '000_setup.sql'), join(folder, '001_dbo.items.sql')])
    expect(readFileSync(files[1]!, 'utf8')).toBe('select 1\nGO\n')
    await output.discard()
    expect(files.some((file) => existsSync(file))).toBe(false)
  })

  it('makes any table name a safe file name', () => {
    expect(safeFileName('a/b:c*"d"<e>|f?\\g')).toBe('a_b_c__d__e__f__g')
  })
})
