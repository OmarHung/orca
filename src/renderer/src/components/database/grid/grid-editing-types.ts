import type { GridBounds, GridCell } from './database-grid-selection'

/** How a grid row differs from what the database returned, for editable table data. */
export type GridRowEditState = {
  kind: 'loaded' | 'inserted' | 'deleted'
  /** Columns whose value differs from the loaded one, or were typed into a new row. */
  modified: ReadonlySet<number>
  /** New-row columns left to the table's default. */
  unset: ReadonlySet<number>
}

/** What an editable grid (table data) needs from its owner; rows are display rows. */
export type GridEditing = {
  rowState: (row: number) => GridRowEditState | null
  /** Row whose change failed on the last submit. */
  failedRow: number | null
  /** Why a cell can't be edited, or null when it can. */
  lockReason: (cell: GridCell) => string | null
  commit: (cell: GridCell, value: string | null) => void
  setNull: (bounds: GridBounds) => void
  deleteRows: (bounds: GridBounds) => void
  revert: (bounds: GridBounds) => void
  /** Set by the owner to start editing a cell, e.g. the first cell of an added row. */
  editRequest: (GridCell & { nonce: number }) | null
  /** Lets toolbar actions (e.g. Delete Rows) act on the grid's selection. */
  onSelectionChange: (bounds: GridBounds | null) => void
}
