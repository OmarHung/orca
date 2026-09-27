import { translate } from '@/i18n/i18n'
import {
  isDatabaseTruncatedCell,
  type DatabaseCell
} from '../../../../../shared/database/database-query-types'
import type { GridRowEditState } from '../grid/grid-editing-types'

export type TableKeyState =
  | { status: 'loading' }
  | { status: 'ready'; keyColumns: string[] }
  | { status: 'failed'; message: string }

const BINARY_TYPE = /^(?:bytea|(?:tiny|medium|long)?blob|(?:var)?binary|image)\b/i

/** Why the whole table can't be edited, or null when it can. */
export function tableLockReason(
  readOnly: boolean,
  keys: TableKeyState,
  resultColumns: readonly string[]
): string | null {
  if (readOnly) {
    return translate('database.edit.readOnly', 'This connection is read-only.')
  }
  switch (keys.status) {
    case 'loading':
      return translate('database.edit.loadingKey', 'Loading the table’s primary key…')
    case 'failed':
      return keys.message
    case 'ready':
      if (keys.keyColumns.length === 0) {
        return translate(
          'database.edit.noKey',
          'This table has no primary key, so its rows can’t be edited.'
        )
      }
      return keys.keyColumns.every((column) => resultColumns.includes(column))
        ? null
        : translate('database.edit.keyMissing', 'The result doesn’t include the primary key.')
  }
}

/** Why one cell can't be edited once the table can; null when it can. */
export function cellLockReason(
  rowState: GridRowEditState | null,
  typeName: string,
  cell: DatabaseCell
): string | null {
  if (rowState?.kind === 'deleted') {
    return translate('database.edit.rowDeleted', 'This row will be deleted. Revert it to edit.')
  }
  if (BINARY_TYPE.test(typeName.trim())) {
    return translate('database.edit.binary', 'Binary values can’t be edited here.')
  }
  if (isDatabaseTruncatedCell(cell)) {
    return translate(
      'database.edit.truncated',
      'Only the start of this value was loaded, so it can’t be edited here.'
    )
  }
  return null
}
