import { describe, expect, it } from 'vitest'
import { findSqlStatementAtOffset, splitSqlStatements } from './sql-statement-splitter'

function texts(sql: string): string[] {
  return splitSqlStatements(sql, 'postgres').map((statement) => statement.text)
}

describe('splitSqlStatements (postgres)', () => {
  it('splits on semicolons and trims whitespace', () => {
    expect(texts('select 1;\n  select 2 ;\nselect 3')).toEqual(['select 1', 'select 2', 'select 3'])
  })

  it('reports offsets that slice back to the statement text', () => {
    const sql = '  select 1;\n\nupdate t set a = 1;'
    for (const statement of splitSqlStatements(sql, 'postgres')) {
      expect(sql.slice(statement.start, statement.end)).toBe(statement.text)
      expect(sql[statement.terminatorEnd - 1]).toBe(';')
    }
  })

  it('ignores semicolons inside strings, quoted identifiers and comments', () => {
    const sql = [
      "select 'a;b', 'it''s;';",
      'select "odd;name" from t;',
      'select 1 -- trailing; comment',
      ';',
      'select /* a; /* nested; */ b; */ 2;'
    ].join('\n')
    expect(texts(sql)).toEqual([
      "select 'a;b', 'it''s;'",
      'select "odd;name" from t',
      'select 1 -- trailing; comment',
      'select /* a; /* nested; */ b; */ 2'
    ])
  })

  it('honours backslash escapes only in E-strings', () => {
    expect(texts("select E'a\\';b';select 'c\\';select 2")).toEqual([
      "select E'a\\';b'",
      "select 'c\\'",
      'select 2'
    ])
  })

  it('keeps dollar-quoted function bodies whole', () => {
    const sql = [
      'create function f() returns int as $body$',
      'begin return 1; end;',
      '$body$ language plpgsql;',
      'select $$a;b$$;',
      'select $1::int'
    ].join('\n')
    expect(texts(sql)).toEqual([
      'create function f() returns int as $body$\nbegin return 1; end;\n$body$ language plpgsql',
      'select $$a;b$$',
      'select $1::int'
    ])
  })

  it('does not treat $ inside identifiers as a dollar quote', () => {
    expect(texts('select a$b$ from t; select 2')).toEqual(['select a$b$ from t', 'select 2'])
  })

  it('drops statements that are only comments or empty', () => {
    expect(texts(';; -- nothing here\n/* or here */;')).toEqual([])
  })

  it('excludes leading comments from the statement start', () => {
    const sql = '-- header\n/* note */ select 1;'
    const [statement] = splitSqlStatements(sql, 'postgres')
    expect(statement?.text).toBe('select 1')
  })

  it('treats an unterminated string as running to the end', () => {
    expect(texts("select 'open; select 2")).toEqual(["select 'open; select 2"])
  })
})

describe('findSqlStatementAtOffset', () => {
  const sql = 'select 1;\n\nselect 2;\nselect 3'
  const statements = splitSqlStatements(sql, 'postgres')

  it('finds the statement containing the offset, including its terminator', () => {
    expect(findSqlStatementAtOffset(statements, 3)?.text).toBe('select 1')
    expect(findSqlStatementAtOffset(statements, sql.indexOf(';') + 1)?.text).toBe('select 1')
    expect(findSqlStatementAtOffset(statements, sql.length)?.text).toBe('select 3')
  })

  it('falls back to the preceding statement between statements', () => {
    expect(findSqlStatementAtOffset(statements, sql.indexOf('\n\n') + 1)?.text).toBe('select 1')
  })

  it('falls back to the following statement before the first one', () => {
    const leading = splitSqlStatements('\n\nselect 9', 'postgres')
    expect(findSqlStatementAtOffset(leading, 0)?.text).toBe('select 9')
  })

  it('returns null when there are no statements', () => {
    expect(findSqlStatementAtOffset([], 0)).toBeNull()
  })
})
