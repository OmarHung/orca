import { describe, expect, it } from 'vitest'
import type {
  DatabaseCell,
  DatabaseColumn
} from '../../../../../shared/database/database-query-types'
import {
  NO_TABLE_EDITS,
  addTableRow,
  buildTableChangeSet,
  deleteTableRows,
  displayTableRows,
  revertTableEdits,
  setTableCell,
  tableEditCount
} from './table-edits'

const columns: DatabaseColumn[] = [
  { name: 'id', typeName: 'integer' },
  { name: 'name', typeName: 'text' },
  { name: 'note', typeName: 'text' }
]
const loaded: DatabaseCell[][] = [
  ['1', 'Ada', null],
  ['2', 'Bob', 'x'],
  ['3', 'Cy', null]
]
const target = {
  loadedRows: loaded,
  columns,
  keyColumns: ['id'],
  schema: 'public',
  relation: 'people'
}

describe('table edits', () => {
  it('records a changed cell, and forgets it when set back to the loaded value', () => {
    const edited = setTableCell(NO_TABLE_EDITS, loaded, 0, 1, 'Ada L.')
    expect(tableEditCount(edited)).toBe(1)
    expect(setTableCell(edited, loaded, 0, 1, 'Ada')).toEqual(NO_TABLE_EDITS)
  })

  it('shows edits in the grid rows with each row’s state', () => {
    let edits = setTableCell(NO_TABLE_EDITS, loaded, 1, 2, null)
    edits = deleteTableRows(edits, [2], loaded.length)
    edits = addTableRow(edits, 'new-1')
    edits = setTableCell(edits, loaded, 3, 1, 'Di')
    const shown = displayTableRows(loaded, edits, columns.length)
    expect(shown.rows).toEqual([
      ['1', 'Ada', null],
      ['2', 'Bob', null],
      ['3', 'Cy', null],
      [null, 'Di', null]
    ])
    expect(shown.rows[0]).toBe(loaded[0])
    expect(shown.rowState(0)).toBeNull()
    expect(shown.rowState(1)).toEqual({ kind: 'loaded', modified: new Set([2]), unset: new Set() })
    expect(shown.rowState(2)).toMatchObject({ kind: 'deleted' })
    expect(shown.rowState(3)).toEqual({
      kind: 'inserted',
      modified: new Set([1]),
      unset: new Set([0, 2])
    })
  })

  it('drops a new row instead of marking it deleted, and reverts per cell or per row', () => {
    let edits = addTableRow(NO_TABLE_EDITS, 'new-1')
    edits = deleteTableRows(edits, [3], loaded.length)
    expect(edits.inserts).toEqual([])

    edits = setTableCell(NO_TABLE_EDITS, loaded, 0, 1, 'A')
    edits = setTableCell(edits, loaded, 0, 2, 'n')
    edits = deleteTableRows(edits, [1], loaded.length)
    const oneCell = revertTableEdits(edits, [0], [2], loaded.length)
    expect(displayTableRows(loaded, oneCell, 3).rows[0]).toEqual(['1', 'A', null])
    expect(revertTableEdits(edits, [0, 1], 'all', loaded.length)).toEqual(NO_TABLE_EDITS)
  })

  it('builds deletes, then updates, then inserts, keyed by the loaded key values', () => {
    let edits = setTableCell(NO_TABLE_EDITS, loaded, 1, 1, 'Robert')
    edits = setTableCell(edits, loaded, 2, 1, 'ignored: row is deleted')
    edits = deleteTableRows(edits, [2], loaded.length)
    edits = addTableRow(edits, 'new-1')
    edits = setTableCell(edits, loaded, 3, 0, '4')
    const built = buildTableChangeSet(edits, target)
    expect(built).toEqual({
      ok: true,
      changeSet: {
        schema: 'public',
        relation: 'people',
        keyColumns: ['id'],
        changes: [
          { kind: 'delete', key: ['3'] },
          { kind: 'update', key: ['2'], set: [{ column: 'name', value: 'Robert' }] },
          { kind: 'insert', values: [{ column: 'id', value: '4' }] }
        ]
      },
      rowForChange: [2, 1, 3]
    })
  })

  it('refuses rows whose key was not loaded in full', () => {
    const truncated: DatabaseCell[][] = [[{ preview: '1', length: 9000 }, 'Ada', null]]
    const edits = setTableCell(NO_TABLE_EDITS, truncated, 0, 1, 'A')
    const built = buildTableChangeSet(edits, { ...target, loadedRows: truncated })
    expect(built).toMatchObject({ ok: false, row: 0 })
  })
})
