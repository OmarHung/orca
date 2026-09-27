import { describe, expect, it } from 'vitest'
import { completionSite, tableReferences, tokenizeSql } from './sql-completion-context'

function at(
  sqlWithCaret: string,
  dialect: 'postgres' | 'mysql' | 'sqlserver' | 'sqlite' = 'postgres'
) {
  const offset = sqlWithCaret.indexOf('|')
  return completionSite(sqlWithCaret.replace('|', ''), offset, dialect)
}

describe('SQL completion context', () => {
  it('skips strings and comments, and unquotes quoted names', () => {
    const tokens = tokenizeSql(`select 'from x' -- from y\nfrom "Order Items" o`, 'postgres')
    expect(tokens.map((token) => `${token.kind}:${token.value}`)).toEqual([
      'word:select',
      'string:from x',
      'word:from',
      'name:Order Items',
      'word:o'
    ])
  })

  it('finds tables with their schema and alias in FROM, JOIN, UPDATE and INTO', () => {
    const sql =
      'select * from public.users u join orders as o on o.user_id = u.id, "Line Items" li where 1 = 1'
    expect(tableReferences(tokenizeSql(sql, 'postgres'))).toEqual([
      { schema: 'public', name: 'users', alias: 'u' },
      { schema: null, name: 'orders', alias: 'o' },
      { schema: null, name: 'Line Items', alias: 'li' }
    ])
    expect(tableReferences(tokenizeSql('update [dbo].[t] set a = 1', 'sqlserver'))).toEqual([
      { schema: 'dbo', name: 't', alias: null }
    ])
  })

  it('keeps a subquery’s FROM list apart from the outer one', () => {
    const sql = 'select * from (select a, b from x where c in (1, 2)) t, y where z = coalesce(p, q)'
    expect(tableReferences(tokenizeSql(sql, 'postgres')).map((ref) => ref.name)).toEqual(['x', 'y'])
    expect(at('select * from (select a from x) t, |')).toMatchObject({ site: { kind: 'relation' } })
    expect(at('select * from x where f(a, |')).toMatchObject({ site: { kind: 'any' } })
  })

  it('suggests tables after FROM or JOIN, in the typed schema if any', () => {
    expect(at('select * from use|')).toMatchObject({
      site: { kind: 'relation', schema: null },
      prefix: 'use'
    })
    expect(at('select * from sales.or|')).toMatchObject({
      site: { kind: 'relation', schema: 'sales' },
      prefix: 'or'
    })
    expect(at('select * from a, |')).toMatchObject({ site: { kind: 'relation' }, prefix: '' })
  })

  it('suggests members after a dot, and anything elsewhere', () => {
    expect(at('select u.| from users u')).toMatchObject({
      site: { kind: 'member', qualifier: 'u' },
      prefix: ''
    })
    expect(at('select `o`.na| from orders o', 'mysql')).toMatchObject({
      site: { kind: 'member', qualifier: 'o' },
      prefix: 'na'
    })
    expect(at('select na| from users')).toMatchObject({ site: { kind: 'any' }, prefix: 'na' })
    expect(at('select * from users where |')).toMatchObject({ site: { kind: 'any' } })
  })

  it('knows the statement’s tables even when the caret is before FROM', () => {
    expect(at('select | from users u join orders o on true').references).toEqual([
      { schema: null, name: 'users', alias: 'u' },
      { schema: null, name: 'orders', alias: 'o' }
    ])
  })
})
