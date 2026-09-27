import { describe, expect, it } from 'vitest'
import { buildTableCountSql, buildTableDataSql, orderByForSort } from './table-data-sql'

const target = { driver: 'postgres' as const, schema: 'public', relation: 'people' }

describe('table data queries', () => {
  it('selects everything when no filter or order is given', () => {
    expect(buildTableDataSql({ ...target, where: '  ', orderBy: '' })).toBe(
      'select * from public.people'
    )
  })

  it('puts each user fragment on its own line so a trailing comment cannot swallow the next clause', () => {
    expect(buildTableDataSql({ ...target, where: 'id > 1 -- recent', orderBy: 'name desc' })).toBe(
      'select * from public.people\nwhere id > 1 -- recent\norder by name desc'
    )
  })

  it('counts with the same filter', () => {
    expect(buildTableCountSql({ ...target, where: 'active' })).toBe(
      'select count(*) from public.people\nwhere active'
    )
  })

  it('builds ORDER BY from a header sort, quoting per dialect', () => {
    expect(orderByForSort('Created At', 'desc', 'sqlserver')).toBe('[Created At] desc')
    expect(orderByForSort('id', 'asc', 'mysql')).toBe('id asc')
  })
})
