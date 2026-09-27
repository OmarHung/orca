import { describe, expect, it } from 'vitest'
import { formatSqlConsole, type SqlFormatEdit } from './sql-console-format'

function apply(text: string, edits: readonly SqlFormatEdit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (current, edit) => current.slice(0, edit.start) + edit.text + current.slice(edit.end),
      text
    )
}

describe('formatSqlConsole', () => {
  it('formats each statement and keeps terminators and comments between them', async () => {
    const text = '-- people\nselect id,name from people where id=1;\n\nupdate t set a=1;'
    const { edits, failure } = await formatSqlConsole(text, 'postgres', null, 2)
    expect(failure).toBeNull()
    expect(apply(text, edits)).toBe(
      '-- people\nselect\n  id,\n  name\nfrom\n  people\nwhere\n  id = 1;\n\nupdate t\nset\n  a = 1;'
    )
  })

  it('leaves GO and DELIMITER lines alone', async () => {
    const sqlserver = 'select top 1 a from t\nGO\nselect b from u'
    const formatted = apply(
      sqlserver,
      (await formatSqlConsole(sqlserver, 'sqlserver', null, 2)).edits
    )
    expect(formatted).toBe('select\n  top 1 a\nfrom\n  t\nGO\nselect\n  b\nfrom\n  u')
    const mysql = 'DELIMITER $$\nselect a from t$$\nDELIMITER ;'
    const edits = (await formatSqlConsole(mysql, 'mysql', null, 2)).edits
    expect(apply(mysql, edits)).toBe('DELIMITER $$\nselect\n  a\nfrom\n  t$$\nDELIMITER ;')
  })

  it('formats only the statements a range touches', async () => {
    const text = 'select a from t; select b from u;'
    const { edits } = await formatSqlConsole(text, 'sqlite', { start: 20, end: 22 }, 4)
    expect(apply(text, edits)).toBe('select a from t; select\n    b\nfrom\n    u;')
  })

  it('reports a statement it cannot parse and still formats the rest', async () => {
    const text = '\\d users;\nselect a from t;'
    const { edits, failure } = await formatSqlConsole(text, 'postgres', null, 2)
    expect(failure).toMatchObject({ statement: '\\d users' })
    expect(failure?.message).toMatch(/parse error/i)
    expect(apply(text, edits)).toBe('\\d users;\nselect\n  a\nfrom\n  t;')
  })
})
