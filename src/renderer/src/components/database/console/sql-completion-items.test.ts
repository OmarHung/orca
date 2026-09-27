import { describe, expect, it } from 'vitest'
import type { DatabaseColumnInfo } from '../../../../../shared/database/database-introspection-types'
import type { SqlDialect } from '../../../../../shared/database/sql-dialect-lexing'
import type { SqlCatalog } from './sql-completion-catalog'
import { sqlCompletions, statementAtCaret } from './sql-completion-items'

function column(name: string, dataType = 'integer'): DatabaseColumnInfo {
  return { name, dataType, nullable: true, defaultValue: null, isPrimaryKey: false }
}

const catalog: SqlCatalog = {
  schemas: async () => [
    { name: 'public', isCurrent: true },
    { name: 'sales', isCurrent: false }
  ],
  relations: async (schema) =>
    schema === 'public'
      ? [
          { name: 'users', kind: 'table' },
          { name: 'Order Items', kind: 'table' },
          { name: 'active_users', kind: 'view' }
        ]
      : schema === 'sales'
        ? [{ name: 'orders', kind: 'table' }]
        : [],
  columns: async (schema, relation) => {
    const key = `${schema}.${relation}`
    if (key === 'public.users') {
      return [column('id'), column('email', 'text')]
    }
    if (key === 'public.Order Items') {
      return [column('id'), column('user_id'), column('Unit Price', 'numeric')]
    }
    return key === 'sales.orders' ? [column('total', 'numeric')] : []
  }
}

async function suggest(sqlWithCaret: string, dialect: SqlDialect = 'postgres') {
  const offset = sqlWithCaret.indexOf('|')
  const { prefix, items } = await sqlCompletions({
    text: sqlWithCaret.replace('|', ''),
    offset,
    dialect,
    catalog
  })
  return { prefix, items, labels: items.map((entry) => `${entry.kind}:${entry.insertText}`) }
}

describe('SQL completions', () => {
  it('lists the current schema’s tables, then schemas, after FROM', async () => {
    const { prefix, labels } = await suggest('select * from us|')
    expect(prefix).toBe('us')
    expect(labels).toEqual([
      'table:users',
      'table:"Order Items"',
      'view:active_users',
      'schema:public',
      'schema:sales'
    ])
  })

  it('lists a schema’s tables after `schema.`', async () => {
    expect((await suggest('select * from sales.|')).labels).toEqual(['table:orders'])
  })

  it('resolves an alias to its table’s columns, quoting names that need it', async () => {
    const { labels, items } = await suggest('select oi.| from "Order Items" oi')
    expect(labels).toEqual(['column:id', 'column:user_id', 'column:"Unit Price"'])
    expect(items[2]).toMatchObject({ label: 'Unit Price', detail: 'numeric · Order Items' })
    expect((await suggest('select o.| from sales.orders o', 'mysql')).labels).toEqual([
      'column:total'
    ])
  })

  it('treats `name.` as a table when it isn’t an alias and as a schema when it names one', async () => {
    expect((await suggest('select users.|')).labels).toEqual(['column:id', 'column:email'])
    expect((await suggest('select * from x where exists (select 1 from sales.|')).labels).toEqual([
      'table:orders'
    ])
    expect((await suggest('select SALES.|')).labels).toEqual(['table:orders'])
  })

  it('offers the statement’s columns, then tables, then keywords elsewhere', async () => {
    const { labels } = await suggest('select | from users u join "Order Items" oi on true')
    expect(labels.slice(0, 5)).toEqual([
      'column:id',
      'column:email',
      'column:id',
      'column:user_id',
      'column:"Unit Price"'
    ])
    expect(labels).toContain('table:users')
    expect(labels).toContain('keyword:SELECT')
    expect(labels).toContain('keyword:RETURNING')
  })

  it('writes keywords in the case being typed', async () => {
    expect((await suggest('sel|')).labels).toContain('keyword:select')
    expect((await suggest('Sel|')).labels).toContain('keyword:SELECT')
    expect((await suggest('sel|', 'sqlserver')).labels).toContain('keyword:top')
  })

  it('suggests nothing from the catalog when it has no current schema', async () => {
    const empty: SqlCatalog = {
      schemas: async () => [],
      relations: async () => [],
      columns: async () => []
    }
    const { items } = await sqlCompletions({
      text: 'select * from ',
      offset: 14,
      dialect: 'postgres',
      catalog: empty
    })
    expect(items).toEqual([])
  })

  it('reads only the statement around the caret', async () => {
    const text = 'select * from sales.orders o;\nselect o.| from users o;\nselect 1'
    expect((await suggest(text)).labels).toEqual(['column:id', 'column:email'])
    const at = (sql: string) =>
      statementAtCaret(sql.replace('|', ''), sql.indexOf('|'), 'postgres').statement
    expect(at('select 1;|')).toBe('')
    expect(at('select 1 |;')).toBe('select 1 ')
    expect(at('select * from |')).toBe('select * from ')
    expect(at('select 1;\nsel|')).toBe('sel')
  })

  it('resolves unqualified names in the console’s picked schema', async () => {
    const { items } = await sqlCompletions({
      text: 'select * from ',
      offset: 14,
      dialect: 'postgres',
      catalog,
      currentSchema: 'sales'
    })
    expect(items.map((entry) => entry.insertText)).toEqual(['orders', 'public', 'sales'])
  })
})
