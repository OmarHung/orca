import { describe, expect, it } from 'vitest'
import { commandRowCount, databaseAlteredBy, leadingKeyword } from './statement-keyword'

describe('statement keywords', () => {
  it('reads the first keyword in upper case', () => {
    expect(leadingKeyword('  delete from t')).toBe('DELETE')
    expect(leadingKeyword('(select 1)')).toBe('')
  })

  it('keeps row counts only for statements that change rows', () => {
    expect(commandRowCount('update t set a = 1', 3)).toBe(3)
    expect(commandRowCount('with gone as (select 1) delete from t', 0)).toBe(0)
    expect(commandRowCount('create table t (a int)', 3)).toBeNull()
    expect(commandRowCount('begin', 0)).toBeNull()
  })

  it('reads the database a DROP or ALTER DATABASE names, as the server would', () => {
    expect(databaseAlteredBy('DROP DATABASE Sales', true)).toBe('sales')
    expect(databaseAlteredBy('drop database if exists "Sales""X" with (force)', true)).toBe(
      'Sales"X'
    )
    expect(databaseAlteredBy('alter database [a]]b] set single_user', false)).toBe('a]b')
    expect(databaseAlteredBy('ALTER DATABASE Sales SET OFFLINE', false)).toBe('Sales')
    expect(databaseAlteredBy('drop table sales', true)).toBeNull()
    expect(databaseAlteredBy('select 1', false)).toBeNull()
  })
})
