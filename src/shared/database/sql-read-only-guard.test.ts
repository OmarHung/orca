import { describe, expect, it } from 'vitest'
import type { SqlDialect } from './sql-dialect-lexing'
import { readOnlyRefusal, readOnlyViolation } from './sql-read-only-guard'

const DIALECTS: SqlDialect[] = ['postgres', 'mysql', 'sqlserver', 'sqlite']

describe('readOnlyViolation', () => {
  it('lets reads through in every dialect', () => {
    const reads = [
      "select * from people where name = 'delete me' -- update later",
      'with recent as (select * from orders) select count(*) from recent',
      "select t.update, t.delete_flag, replace(name, 'a', 'b') from t",
      'select "drop", "create" from t',
      '/* insert into t values (1) */ select 1'
    ]
    for (const dialect of DIALECTS) {
      for (const sql of reads) {
        expect(readOnlyViolation(sql, dialect), `${dialect}: ${sql}`).toBeNull()
      }
    }
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      expect(readOnlyViolation('explain select 1', dialect), dialect).toBeNull()
    }
    expect(readOnlyViolation('show tables', 'mysql')).toBeNull()
    expect(readOnlyViolation("select insert('abc', 1, 1, 'x')", 'mysql')).toBeNull()
    expect(readOnlyViolation('use sales', 'mysql')).toBeNull()
    expect(readOnlyViolation('pragma table_info(people)', 'sqlite')).toBeNull()
    expect(readOnlyViolation('exec sp_help people', 'sqlserver')).toBeNull()
    expect(readOnlyViolation('set search_path to sales', 'postgres')).toBeNull()
  })

  it('refuses statements that change data, schema, permissions or the server', () => {
    const writes: [string, SqlDialect, string][] = [
      ['insert into t values (1)', 'postgres', 'INSERT'],
      ['UPDATE t SET a = 1', 'mysql', 'UPDATE'],
      ['delete from t', 'sqlite', 'DELETE'],
      ['replace into t values (1)', 'mysql', 'REPLACE'],
      ['create table t (a int)', 'postgres', 'CREATE'],
      ['drop table t', 'sqlserver', 'DROP'],
      ['truncate table t', 'mysql', 'TRUNCATE'],
      ['grant select on t to bob', 'postgres', 'GRANT'],
      ["vacuum into '/tmp/copy.db'", 'sqlite', 'VACUUM'],
      ["attach database 'x.db' as x", 'sqlite', 'ATTACH'],
      ["comment on table t is 'x'", 'postgres', 'COMMENT'],
      ['do $$ begin perform 1; end $$', 'postgres', 'DO'],
      ["load data infile 'x' into table t", 'mysql', 'LOAD'],
      ["backup database sales to disk = 'x'", 'sqlserver', 'BACKUP']
    ]
    for (const [sql, dialect, word] of writes) {
      expect(readOnlyViolation(sql, dialect), sql).toBe(word)
    }
  })

  it('finds writes hidden inside reads and batches', () => {
    expect(
      readOnlyViolation('with gone as (delete from t returning *) select * from gone', 'postgres')
    ).toBe('DELETE')
    expect(readOnlyViolation('select 1\ndelete from t', 'sqlserver')).toBe('DELETE')
    expect(readOnlyViolation('select 1; update t set a = 1', 'mysql')).toBe('UPDATE')
    expect(readOnlyViolation('select * from t for update', 'postgres')).toBe('UPDATE')
    expect(readOnlyViolation('explain analyze delete from t', 'postgres')).toBe('DELETE')
    expect(readOnlyViolation("select 1 backup database x to disk = 'y'", 'sqlserver')).toBe(
      'BACKUP'
    )
  })

  it('refuses ways out of the read-only session', () => {
    expect(readOnlyViolation('begin read write', 'postgres')).toBe('READ WRITE')
    expect(readOnlyViolation('start transaction read write', 'mysql')).toBe('READ WRITE')
    expect(readOnlyViolation('set default_transaction_read_only = off', 'postgres')).toBe(
      'DEFAULT_TRANSACTION_READ_ONLY'
    )
    expect(readOnlyViolation('set session transaction_read_only = 0', 'mysql')).toBe(
      'TRANSACTION_READ_ONLY'
    )
    expect(readOnlyViolation('set global max_connections = 10', 'mysql')).toBe('SET GLOBAL')
    expect(readOnlyViolation('set implicit_transactions off', 'sqlserver')).toBe(
      'IMPLICIT_TRANSACTIONS'
    )
    expect(readOnlyViolation('commit', 'sqlserver')).toBe('COMMIT')
    expect(readOnlyViolation('select 1 rollback', 'sqlserver')).toBe('ROLLBACK')
    expect(readOnlyViolation("select * into outfile '/tmp/x' from t", 'mysql')).toBe('INTO OUTFILE')
  })

  it('refuses read-only escapes written as functions, qualified names or dynamic SQL', () => {
    expect(
      readOnlyViolation(
        "select set_config('default_transaction_read_only', 'off', false)",
        'postgres'
      )
    ).toBe('SET_CONFIG')
    expect(readOnlyViolation("select pg_catalog.set_config('x', 'y', false)", 'postgres')).toBe(
      'SET_CONFIG'
    )
    expect(readOnlyViolation('set @@session.transaction_read_only = 0', 'mysql')).toBe(
      'TRANSACTION_READ_ONLY'
    )
    expect(readOnlyViolation("exec('delete from t; commit')", 'sqlserver')).toBe('EXEC')
    expect(readOnlyViolation("execute ('select 1')", 'sqlserver')).toBe('EXECUTE')
    expect(readOnlyViolation("exec sp_executesql N'delete from t'", 'sqlserver')).toBe(
      'SP_EXECUTESQL'
    )
    expect(readOnlyViolation('exec sp_help t', 'sqlserver')).toBeNull()
  })

  it('refuses procedure calls, which can commit and leave read-only on their own', () => {
    expect(readOnlyViolation('call archive_orders()', 'postgres')).toBe('CALL')
    expect(readOnlyViolation('CALL archive_orders(1)', 'mysql')).toBe('CALL')
    expect(readOnlyViolation('select 1; call archive_orders()', 'mysql')).toBe('CALL')
    // A procedure name inside a string is invisible to the check: MySQL runs it through PREPARE.
    expect(readOnlyViolation("prepare s from 'call archive_orders()'", 'mysql')).toBe('PREPARE')
    expect(readOnlyViolation('execute s', 'mysql')).toBe('EXECUTE')
    // PostgreSQL prepares only queries and DML, which the read-only session refuses itself.
    expect(readOnlyViolation('prepare s as select 1', 'postgres')).toBeNull()
    expect(readOnlyViolation('exec dbo.archive_orders', 'sqlserver')).toBe('EXEC')
  })

  it('says why a procedure call is refused, and which SQL Server procedures still run', () => {
    expect(readOnlyRefusal('INSERT', 'postgres')).toBe(
      "Orca's database tools are read-only, so INSERT statements are not run."
    )
    expect(readOnlyRefusal('CALL', 'mysql')).toMatch(/can commit and write on its own\.$/)
    expect(readOnlyRefusal('EXEC', 'sqlserver')).toMatch(
      /Only these system procedures run: sp_help,/
    )
  })
})
