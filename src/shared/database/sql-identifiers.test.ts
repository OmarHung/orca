import { describe, expect, it } from 'vitest'
import { qualifiedRelationName, quoteSqlName } from './sql-identifiers'

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

  it('quotes reserved words in any letter case', () => {
    expect(qualifiedRelationName('public', 'user')).toBe('public."user"')
    expect(quoteSqlName('order', 'postgres')).toBe('"order"')
    expect(quoteSqlName('Order', 'mysql')).toBe('`Order`')
    expect(quoteSqlName('KEY', 'sqlserver')).toBe('[KEY]')
    expect(quoteSqlName('group', 'sqlite')).toBe('"group"')
    expect(quoteSqlName('name', 'sqlserver')).toBe('name')
  })
})
