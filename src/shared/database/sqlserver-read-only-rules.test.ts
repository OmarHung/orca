import { describe, expect, it } from 'vitest'
import { readOnlyViolation } from './sql-read-only-guard'
import { SQL_SERVER_READ_ONLY_PROCEDURES } from './sqlserver-read-only-rules'

const refused = (sql: string) => readOnlyViolation(sql, 'sqlserver')

describe('SQL Server read-only rules', () => {
  it('refuses every way of running a procedure that isn’t a read-only system one', () => {
    const calls = [
      'exec dbo.archive_orders',
      'EXECUTE dbo.archive_orders @before = 1',
      'exec [dbo].[archive_orders]',
      'exec @status = dbo.archive_orders',
      // A variable holds a name the check can't read.
      "declare @proc sysname = N'dbo.archive_orders'; exec @proc",
      'exec @status = @proc',
      // The first statement of a batch runs a procedure without EXEC.
      'dbo.archive_orders',
      'archive_orders 1, 2',
      ';;archive_orders',
      '/* first */ archive_orders',
      'explain select 1',
      // Later statements in the batch.
      'select 1 exec dbo.archive_orders',
      'exec sp_help; exec dbo.archive_orders',
      // Right name, wrong place: only a bare name or sys resolves to the system procedure.
      'exec dbo.sp_help',
      'exec master.dbo.sp_help',
      'exec master..sp_help',
      // A case-sensitive database resolves SP_HELP to a user procedure, not sys.sp_help.
      'exec SP_HELP',
      "exec xp_cmdshell 'dir'",
      "execute as login = 'sa'",
      "exec ('delete from t')"
    ]
    for (const sql of calls) {
      expect(refused(sql), sql).toBe('EXEC')
    }
  })

  it('runs the read-only system procedures, bare or in sys, with or without EXEC', () => {
    const reads = [
      'exec sp_help',
      "exec sp_help 'dbo.orders'",
      "EXECUTE sys.sp_helptext N'dbo.orders_view'",
      "exec [sys].[sp_columns] @table_name = N'orders'",
      'exec @status = sp_who',
      'sp_help',
      "sp_helpindex 'dbo.orders'"
    ]
    for (const sql of reads) {
      expect(refused(sql), sql).toBeNull()
    }
    for (const name of SQL_SERVER_READ_ONLY_PROCEDURES) {
      expect(refused(`exec ${name}`), name).toBeNull()
    }
  })

  it('refuses a sequence’s next value, which no rollback returns', () => {
    expect(refused('select next value for dbo.order_ids')).toBe('NEXT VALUE FOR')
    expect(refused('SELECT NEXT  VALUE\nFOR [dbo].[order_ids] AS id')).toBe('NEXT VALUE FOR')
    expect(refused('select next value for s over (order by id) from t')).toBe('NEXT VALUE FOR')
  })

  it('refuses statements that write without a generic write keyword', () => {
    const writes: [string, string][] = [
      ['select * into dbo.orders_copy from dbo.orders', 'SELECT INTO'],
      ['select * into #orders from dbo.orders', 'SELECT INTO'],
      ["select * from openquery(linked, 'delete from t')", 'OPENQUERY'],
      ["select * from openrowset('MSOLEDBSQL', 'server=x', 'select 1')", 'OPENROWSET'],
      ["select * from opendatasource('MSOLEDBSQL', 'x').db.dbo.t", 'OPENDATASOURCE'],
      ['disable trigger orders_audit on dbo.orders', 'DISABLE'],
      ['enable trigger all on database', 'ENABLE'],
      ['receive top (1) * from dbo.order_queue', 'RECEIVE'],
      ["send on conversation @handle message type [m] ('x')", 'SEND'],
      ['end conversation @handle', 'END CONVERSATION'],
      ["begin dialog @handle from service a to service 'b'", 'BEGIN DIALOG'],
      ["writetext dbo.docs.body @pointer 'x'", 'WRITETEXT'],
      ['add signature to dbo.p by certificate c', 'ADD SIGNATURE']
    ]
    for (const [sql, word] of writes) {
      expect(refused(sql), sql).toBe(word)
    }
  })

  it('lets reads, control flow, cursors and literals through', () => {
    const reads = [
      ';with recent as (select * from dbo.orders) select * from recent',
      'begin try select 1 end try begin catch select 0 end catch',
      'declare @count int = 1; select @count',
      'declare c cursor for select id from t; open c; fetch next from c into @id; close c; deallocate c',
      "select 'exec dbo.archive_orders', N'next value for s', [into] from t",
      'select t.exec, t.into, next_id from t',
      '-- exec dbo.archive_orders\nselect 1',
      'use sales',
      'set nocount on',
      "waitfor delay '00:00:01'",
      'print 1',
      '(select 1)',
      "if exists (select 1 from t) print 'yes'"
    ]
    for (const sql of reads) {
      expect(refused(sql), sql).toBeNull()
    }
  })
})
