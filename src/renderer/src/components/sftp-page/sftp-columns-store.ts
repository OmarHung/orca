import { create } from 'zustand'
import {
  clampSftpColumnWidth,
  DEFAULT_SFTP_COLUMN_WIDTHS,
  TOGGLEABLE_SFTP_COLUMNS,
  type SftpColumnId,
  type SftpColumnWidths
} from './sftp-columns'
import { DEFAULT_SFTP_SORT, type SftpSort } from './sftp-entry-sort'

export type SftpPaneId = 'local' | 'remote'

type PersistedColumns = {
  hiddenColumns: SftpColumnId[]
  sortByPane: Record<SftpPaneId, SftpSort>
  columnWidths: SftpColumnWidths
}

type SftpColumnsState = PersistedColumns & {
  toggleColumn: (column: SftpColumnId) => void
  setSort: (pane: SftpPaneId, sort: SftpSort) => void
  /** `shouldPersist` false while dragging; the final width is saved on release. */
  setColumnWidth: (column: SftpColumnId, width: number, shouldPersist?: boolean) => void
  resetColumnWidth: (column: SftpColumnId) => void
}

// Why localStorage: a per-viewer layout preference, like the host list's collapse state.
const STORAGE_KEY = 'orca.sftpColumns'
const COLUMN_IDS: readonly string[] = ['name', ...TOGGLEABLE_SFTP_COLUMNS]

function isColumnId(value: unknown): value is SftpColumnId {
  return typeof value === 'string' && COLUMN_IDS.includes(value)
}

function readSort(value: unknown): SftpSort {
  if (typeof value === 'object' && value !== null) {
    const stored: Record<string, unknown> = { ...value }
    if (isColumnId(stored.column) && (stored.direction === 'asc' || stored.direction === 'desc')) {
      return { column: stored.column, direction: stored.direction }
    }
  }
  return DEFAULT_SFTP_SORT
}

function readWidths(value: unknown): SftpColumnWidths {
  const stored: Record<string, unknown> =
    typeof value === 'object' && value !== null ? { ...value } : {}
  const widths = { ...DEFAULT_SFTP_COLUMN_WIDTHS }
  for (const column of COLUMN_IDS) {
    const width = stored[column]
    if (isColumnId(column) && typeof width === 'number' && Number.isFinite(width)) {
      widths[column] = clampSftpColumnWidth(width)
    }
  }
  return widths
}

function readPersisted(): PersistedColumns {
  let stored: Record<string, unknown> = {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (typeof parsed === 'object' && parsed !== null) {
      stored = { ...parsed }
    }
  } catch {
    // Corrupt or unavailable storage falls back to every column, sorted by name.
  }
  const hidden = Array.isArray(stored.hiddenColumns) ? stored.hiddenColumns : []
  const sortByPane: Record<string, unknown> =
    typeof stored.sortByPane === 'object' && stored.sortByPane !== null
      ? { ...stored.sortByPane }
      : {}
  return {
    hiddenColumns: hidden.filter(
      (column): column is SftpColumnId => isColumnId(column) && column !== 'name'
    ),
    sortByPane: { local: readSort(sortByPane.local), remote: readSort(sortByPane.remote) },
    columnWidths: readWidths(stored.columnWidths)
  }
}

function writePersisted(value: PersistedColumns): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; the layout just won't survive a reload.
  }
}

function persistedFrom(state: PersistedColumns): PersistedColumns {
  return {
    hiddenColumns: state.hiddenColumns,
    sortByPane: state.sortByPane,
    columnWidths: state.columnWidths
  }
}

export const useSftpColumnsStore = create<SftpColumnsState>((set, get) => ({
  ...readPersisted(),
  toggleColumn: (column) => {
    if (column === 'name') {
      return
    }
    const { hiddenColumns } = get()
    const next = hiddenColumns.includes(column)
      ? hiddenColumns.filter((hidden) => hidden !== column)
      : [...hiddenColumns, column]
    set({ hiddenColumns: next })
    writePersisted(persistedFrom(get()))
  },
  setSort: (pane, sort) => {
    set({ sortByPane: { ...get().sortByPane, [pane]: sort } })
    writePersisted(persistedFrom(get()))
  },
  setColumnWidth: (column, width, shouldPersist = true) => {
    set({ columnWidths: { ...get().columnWidths, [column]: clampSftpColumnWidth(width) } })
    if (shouldPersist) {
      writePersisted(persistedFrom(get()))
    }
  },
  resetColumnWidth: (column) => {
    set({
      columnWidths: { ...get().columnWidths, [column]: DEFAULT_SFTP_COLUMN_WIDTHS[column] }
    })
    writePersisted(persistedFrom(get()))
  }
}))
