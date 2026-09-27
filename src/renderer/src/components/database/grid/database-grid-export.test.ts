import { describe, expect, it } from 'vitest'
import { gridExportSlice, toCsv, toInsertSql, toJson, toTsv } from './database-grid-export'

const columns = [
  { name: 'id', typeName: 'integer' },
  { name: 'name', typeName: 'text' },
  { name: 'id', typeName: 'bigint' }
]
const rows = [
  ['1', 'Ada', '10'],
  ['2', 'O\'Brien, "Bob"\nJr', null]
]

describe('grid export', () => {
  it('slices the selected rectangle in display order', () => {
    const slice = gridExportSlice(columns, rows, [1, 0], { top: 0, bottom: 0, left: 1, right: 2 })
    expect(slice.columns.map((column) => column.name)).toEqual(['name', 'id'])
    expect(slice.rows).toEqual([['O\'Brien, "Bob"\nJr', null]])
    expect(gridExportSlice(columns, rows, [0, 1], null).rows).toHaveLength(2)
  })

  it('copies TSV that spreadsheets paste back into the same cells', () => {
    expect(toTsv({ columns, rows }, { header: true })).toBe(
      'id\tname\tid\n1\tAda\t10\n2\t"O\'Brien, ""Bob""\nJr"\t'
    )
  })

  it('writes RFC 4180 CSV with a header', () => {
    expect(toCsv({ columns, rows })).toBe('id,name,id\n1,Ada,10\n2,"O\'Brien, ""Bob""\nJr",')
  })

  it('writes JSON objects, disambiguating repeated column names and keeping NULL', () => {
    expect(JSON.parse(toJson({ columns, rows }))).toEqual([
      { id: '1', name: 'Ada', id_2: '10' },
      { id: '2', name: 'O\'Brien, "Bob"\nJr', id_2: null }
    ])
  })

  it('writes INSERT statements with dialect quoting and unquoted numbers', () => {
    const sql = toInsertSql(
      {
        columns: [columns[0]!, columns[1]!],
        rows: [
          ['1', "it's"],
          ['x', null]
        ]
      },
      { table: 'people', driver: 'mysql' }
    )
    expect(sql).toBe(
      "INSERT INTO people (id, name) VALUES (1, 'it''s');\nINSERT INTO people (id, name) VALUES ('x', NULL);"
    )
  })

  it('doubles backslashes only where the dialect treats them as escapes', () => {
    const input = { columns: [{ name: 'path', typeName: 'text' }], rows: [['C:\\temp']] }
    expect(toInsertSql(input, { table: 't', driver: 'mysql' })).toContain("'C:\\\\temp'")
    expect(toInsertSql(input, { table: 't', driver: 'postgres' })).toContain("'C:\\temp'")
  })
})
