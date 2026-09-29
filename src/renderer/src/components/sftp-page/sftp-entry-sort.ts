import type { SftpEntry } from '../../../../shared/sftp-types'
import { sftpEntryTypeLabel, type SftpColumnId } from './sftp-columns'

export type SftpSort = { column: SftpColumnId; direction: 'asc' | 'desc' }

export const DEFAULT_SFTP_SORT: SftpSort = { column: 'name', direction: 'asc' }

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareByColumn(a: SftpEntry, b: SftpEntry, column: SftpColumnId): number {
  switch (column) {
    case 'name':
      return NAME_COLLATOR.compare(a.name, b.name)
    case 'size':
      return a.size - b.size
    case 'modified':
      return a.modifiedMs - b.modifiedMs
    case 'created':
      return (a.createdMs ?? 0) - (b.createdMs ?? 0)
    case 'type':
      return NAME_COLLATOR.compare(sftpEntryTypeLabel(a), sftpEntryTypeLabel(b))
    case 'owner':
      return NAME_COLLATOR.compare(a.owner ?? '', b.owner ?? '')
  }
}

/** Folders stay first, like file managers; ties fall back to the name. */
export function sortSftpEntriesBy(entries: readonly SftpEntry[], sort: SftpSort): SftpEntry[] {
  const factor = sort.direction === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    const folders = Number(b.kind === 'directory') - Number(a.kind === 'directory')
    if (folders !== 0) {
      return folders
    }
    const byColumn = compareByColumn(a, b, sort.column) * factor
    return byColumn !== 0 ? byColumn : NAME_COLLATOR.compare(a.name, b.name)
  })
}

/** Clicking the sorted column flips its direction; another column starts ascending. */
export function nextSftpSort(current: SftpSort, column: SftpColumnId): SftpSort {
  return current.column === column
    ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { column, direction: 'asc' }
}
