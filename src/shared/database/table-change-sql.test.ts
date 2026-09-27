import { describe, expect, it } from 'vitest'
import {
  tableChangePreview,
  tableChangeSetSchema,
  tableChangeStatements,
  type TableChangeSet
} from './table-change-sql'

const changeSet: TableChangeSet = {
  schema: 'public',
  relation: 'user',
  keyColumns: ['id'],
  changes: [
    { kind: 'delete', key: ['7'] },
    {
      kind: 'update',
      key: ['1'],
      set: [
        { column: 'name', value: "O'Brien" },
        { column: 'order', value: null }
      ]
    },
    { kind: 'insert', values: [{ column: 'name', value: "x'); drop table t; --" }] },
    { kind: 'insert', values: [] }
  ]
}

describe('table change statements', () => {
  it('binds every value as a parameter in the order it appears in the SQL', () => {
    const statements = tableChangeStatements('postgres', changeSet)
    expect(statements).toEqual([
      { sql: 'DELETE FROM public."user" WHERE id = $1', params: ['7'], expectOneRow: true },
      {
        sql: 'UPDATE public."user" SET name = $1, "order" = $2 WHERE id = $3',
        params: ["O'Brien", null, '1'],
        expectOneRow: true
      },
      {
        sql: 'INSERT INTO public."user" (name) VALUES ($1)',
        params: ["x'); drop table t; --"],
        expectOneRow: false
      },
      { sql: 'INSERT INTO public."user" DEFAULT VALUES', params: [], expectOneRow: false }
    ])
  })

  it("uses each dialect's placeholders, quoting and empty insert", () => {
    const mysql = tableChangeStatements('mysql', { ...changeSet, schema: 'shop' })
    expect(mysql[1]?.sql).toBe('UPDATE shop.user SET name = ?, `order` = ? WHERE id = ?')
    expect(mysql[3]?.sql).toBe('INSERT INTO shop.user () VALUES ()')
    const sqlServer = tableChangeStatements('sqlserver', { ...changeSet, schema: 'dbo' })
    expect(sqlServer[1]?.sql).toBe('UPDATE dbo.[user] SET name = @p1, [order] = @p2 WHERE id = @p3')
    const sqlite = tableChangeStatements('sqlite', { ...changeSet, schema: 'main' })
    expect(sqlite[0]?.sql).toBe('DELETE FROM user WHERE id = ?')
  })

  it('matches every key column of a composite key', () => {
    const [statement] = tableChangeStatements('postgres', {
      schema: 'public',
      relation: 'line',
      keyColumns: ['order_id', 'line_no'],
      changes: [{ kind: 'delete', key: ['5', '2'] }]
    })
    expect(statement).toMatchObject({
      sql: 'DELETE FROM public.line WHERE order_id = $1 AND line_no = $2',
      params: ['5', '2']
    })
  })

  it('previews the same statements with literals, numbers unquoted in numeric columns', () => {
    expect(tableChangePreview('mysql', { ...changeSet, schema: 'shop' }, new Set(['id']))).toBe(
      [
        'DELETE FROM shop.user WHERE id = 7;',
        "UPDATE shop.user SET name = 'O''Brien', `order` = NULL WHERE id = 1;",
        "INSERT INTO shop.user (name) VALUES ('x''); drop table t; --');",
        'INSERT INTO shop.user () VALUES ();'
      ].join('\n')
    )
  })

  it('rejects change sets whose keys do not match the key columns', () => {
    const mismatched = { ...changeSet, changes: [{ kind: 'delete', key: ['1', '2'] }] }
    expect(tableChangeSetSchema.safeParse(mismatched).success).toBe(false)
    expect(tableChangeSetSchema.safeParse(changeSet).success).toBe(true)
  })
})
