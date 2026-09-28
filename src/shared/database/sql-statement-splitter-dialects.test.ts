import { describe, expect, it } from 'vitest'
import { splitSqlBatches, splitSqlStatements, type SqlDialect } from './sql-statement-splitter'

function texts(sql: string, dialect: SqlDialect): string[] {
  return splitSqlStatements(sql, dialect).map((statement) => statement.text)
}

function batches(sql: string, dialect: SqlDialect): string[] {
  return splitSqlBatches(sql, dialect).map((statement) => statement.text)
}

describe('splitSqlStatements (mysql)', () => {
  it('honours backticks, backslash escapes, # comments and "-- " comments', () => {
    const sql = [
      'select `a;b`, \'it\\\'s;\', "x\\";y";',
      'select 1 # trailing; comment',
      ';',
      'select 2 -- note; here',
      ';select 3--4;'
    ].join('\n')
    expect(texts(sql, 'mysql')).toEqual([
      'select `a;b`, \'it\\\'s;\', "x\\";y"',
      'select 1 # trailing; comment',
      'select 2 -- note; here',
      'select 3--4'
    ])
  })

  it('switches terminators with DELIMITER and drops the DELIMITER lines', () => {
    const sql = [
      'DELIMITER $$',
      'create procedure p() begin select 1; select 2; end$$',
      'DELIMITER ;',
      'call p();'
    ].join('\n')
    expect(texts(sql, 'mysql')).toEqual([
      'create procedure p() begin select 1; select 2; end',
      'call p()'
    ])
  })

  it('keeps executable comments as statement content', () => {
    expect(texts('/*!40101 SET NAMES utf8 */;\nselect 1;', 'mysql')).toEqual([
      '/*!40101 SET NAMES utf8 */',
      'select 1'
    ])
    // MariaDB runs `/*M!…*/` too, so a script of only that is still a statement.
    expect(texts('/*M!100100 SET NAMES utf8 */;', 'mysql')).toEqual([
      '/*M!100100 SET NAMES utf8 */'
    ])
  })
})

describe('splitSqlStatements (sqlserver)', () => {
  it('splits on semicolons and GO lines, honouring brackets and N-strings', () => {
    const sql = ["select [a;b], N'x;y'", 'GO', 'select 1; select 2', '  go  ', 'select "q;r"'].join(
      '\n'
    )
    expect(texts(sql, 'sqlserver')).toEqual([
      "select [a;b], N'x;y'",
      'select 1',
      'select 2',
      'select "q;r"'
    ])
  })

  it('does not treat GO inside a line or a string as a separator', () => {
    expect(texts("select 'GO'\nselect go_value from t", 'sqlserver')).toEqual([
      "select 'GO'\nselect go_value from t"
    ])
  })
})

describe('splitSqlBatches', () => {
  it('keeps SQL Server batches whole so variables stay in scope', () => {
    const sql = 'declare @x int = 1;\nselect @x;\nGO\nselect 2;'
    expect(batches(sql, 'sqlserver')).toEqual(['declare @x int = 1;\nselect @x;', 'select 2;'])
  })

  it('matches statement splitting for dialects without batches', () => {
    expect(batches('select 1; select 2', 'postgres')).toEqual(['select 1', 'select 2'])
  })
})

describe('splitSqlStatements (sqlite)', () => {
  it('keeps trigger bodies whole, including CASE … END inside them', () => {
    const sql = [
      'create trigger t after insert on a begin',
      "  update b set c = case when new.x > 0 then 'p;' else 'n' end;",
      '  insert into log values (1);',
      'end;',
      'select [x;y], `z;w` from a;'
    ].join('\n')
    expect(texts(sql, 'sqlite')).toEqual([
      "create trigger t after insert on a begin\n  update b set c = case when new.x > 0 then 'p;' else 'n' end;\n  insert into log values (1);\nend",
      'select [x;y], `z;w` from a'
    ])
  })

  it('does not treat BEGIN transactions as blocks', () => {
    expect(texts('begin; insert into a values (1); commit;', 'sqlite')).toEqual([
      'begin',
      'insert into a values (1)',
      'commit'
    ])
  })
})
