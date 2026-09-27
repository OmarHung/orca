import { describe, expect, it } from 'vitest'
import {
  SQL_SCRIPT_START,
  splitSqlBatches,
  takeSqlScriptBatches,
  type SqlDialect
} from './sql-statement-splitter'

/** Feeds `sql` in `size`-character pieces the way a file stream would, collecting batch texts. */
function streamed(sql: string, dialect: SqlDialect, size: number): string[] {
  const texts: string[] = []
  let buffer = ''
  let cursor = SQL_SCRIPT_START
  for (let offset = 0; offset < sql.length; offset += size) {
    buffer += sql.slice(offset, offset + size)
    const taken = takeSqlScriptBatches(buffer, dialect, cursor, false)
    texts.push(...taken.statements.map((statement) => statement.text))
    buffer = buffer.slice(taken.consumed)
    cursor = taken.cursor
  }
  const rest = takeSqlScriptBatches(buffer, dialect, cursor, true)
  return [...texts, ...rest.statements.map((statement) => statement.text)]
}

function expectSameAtEveryChunkSize(sql: string, dialect: SqlDialect): void {
  const whole = splitSqlBatches(sql, dialect).map((statement) => statement.text)
  for (let size = 1; size <= sql.length; size += 1) {
    expect(streamed(sql, dialect, size), `chunk size ${size}`).toEqual(whole)
  }
}

describe('takeSqlScriptBatches', () => {
  it('splits a streamed script exactly like the whole one (mysql, DELIMITER)', () => {
    const sql = [
      "insert into t values ('a;b'); insert into t values ('it''s');",
      'DELIMITER //',
      'create procedure p() begin select 1; select 2; end //',
      'create procedure q() begin select 3; end //',
      'DELIMITER ;',
      '-- trailing; comment',
      'select 3; select 4'
    ].join('\n')
    expectSameAtEveryChunkSize(sql, 'mysql')
  })

  it('splits a streamed script exactly like the whole one (sqlserver, GO)', () => {
    const sql = [
      'declare @x int = 1;',
      'select @x;',
      'GO',
      "select 'go';",
      'go 2',
      'select 1 as gopher',
      'GO'
    ].join('\n')
    expectSameAtEveryChunkSize(sql, 'sqlserver')
  })

  it('splits a streamed script exactly like the whole one (postgres, $$ and comments)', () => {
    const sql = [
      'create function f() returns int as $$ begin return 1; end $$ language plpgsql;',
      '/* a; block */ select 1;',
      "select E'x\\';y';"
    ].join('\n')
    expectSameAtEveryChunkSize(sql, 'postgres')
  })

  it('splits a streamed script exactly like the whole one (sqlite, trigger bodies)', () => {
    const sql = [
      'create table t (a);',
      'create trigger tr after insert on t begin update t set a = 1; end;',
      'select 1'
    ].join('\n')
    expectSameAtEveryChunkSize(sql, 'sqlite')
  })

  it('holds back an unfinished statement and a line not yet ended', () => {
    const first = takeSqlScriptBatches(
      "select 1; select 'unfinished;",
      'postgres',
      SQL_SCRIPT_START,
      false
    )
    expect(first.statements).toEqual([])
    expect(first.consumed).toBe(0)

    const second = takeSqlScriptBatches(
      "select 1; select 'x';\nselect",
      'postgres',
      SQL_SCRIPT_START,
      false
    )
    expect(second.statements.map((statement) => statement.text)).toEqual(['select 1', "select 'x'"])
    expect(second.consumed).toBe("select 1; select 'x';".length)
  })

  it('does not take a DELIMITER that only follows a statement on its line', () => {
    const sql = 'select 1; DELIMITER //\nselect 2 //'
    expectSameAtEveryChunkSize(sql, 'mysql')
  })
})
