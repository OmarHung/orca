import { describe, expect, it } from 'vitest'
import { findWriteKeyword } from './read-only-sql-guard'
import { sqlServerTypeName } from './sqlserver-values'

describe('findWriteKeyword', () => {
  it('allows reads, variables and procedure-free batches', () => {
    expect(
      findWriteKeyword('declare @x int = 1;\nselect * from t where a = @x', 'sqlserver')
    ).toBeNull()
    expect(findWriteKeyword('with c as (select 1 as a) select a from c', 'sqlserver')).toBeNull()
  })

  it('finds writes, SELECT … INTO and procedure calls', () => {
    expect(findWriteKeyword('update t set a = 1', 'sqlserver')).toBe('update')
    expect(findWriteKeyword('select * into backup_t from t', 'sqlserver')).toBe('into')
    expect(findWriteKeyword('EXEC sp_who', 'sqlserver')).toBe('EXEC')
  })

  it('ignores keywords inside strings, bracketed names and comments', () => {
    expect(
      findWriteKeyword(
        "select 'delete me', [update] from t -- drop table t\n/* insert */",
        'sqlserver'
      )
    ).toBeNull()
  })

  it('does not match keywords inside longer identifiers', () => {
    expect(findWriteKeyword('select updated_at, created_by from t', 'sqlserver')).toBeNull()
  })
})

describe('sqlServerTypeName', () => {
  const meta = (name: string, extra: Partial<Parameters<typeof sqlServerTypeName>[0]> = {}) => ({
    colName: 'c',
    type: { name },
    ...extra
  })

  it('maps tedious nullable wire types to DDL names', () => {
    expect(sqlServerTypeName(meta('IntN', { dataLength: 8 }))).toBe('bigint')
    expect(sqlServerTypeName(meta('FloatN', { dataLength: 4 }))).toBe('real')
    expect(sqlServerTypeName(meta('DecimalN', { precision: 18, scale: 2 }))).toBe('decimal(18,2)')
  })

  it('shows character lengths, halving bytes for Unicode and spelling out max', () => {
    expect(sqlServerTypeName(meta('NVarChar', { dataLength: 100 }))).toBe('nvarchar(50)')
    expect(sqlServerTypeName(meta('VarChar', { dataLength: 0xffff }))).toBe('varchar(max)')
  })
})
