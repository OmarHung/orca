import { describe, expect, it } from 'vitest'
import { qualifiedRelationName, quoteSqlName } from './database-sql-names'

describe('SQL names', () => {
  it('quotes identifiers only when needed, in each dialect’s style', () => {
    expect(qualifiedRelationName('public', 'users')).toBe('public.users')
    expect(qualifiedRelationName('Sales', 'order "items"')).toBe('"Sales"."order ""items"""')
    expect(qualifiedRelationName('shop', 'Order Items', 'mysql')).toBe('shop.`Order Items`')
    expect(qualifiedRelationName('dbo', 'a]b', 'sqlserver')).toBe('dbo.[a]]b]')
    expect(qualifiedRelationName('main', 'people', 'sqlite')).toBe('people')
  })

  it('treats PostgreSQL upper-case names as needing quotes', () => {
    expect(quoteSqlName('Name', 'postgres')).toBe('"Name"')
    expect(quoteSqlName('Name', 'mysql')).toBe('Name')
  })
})
