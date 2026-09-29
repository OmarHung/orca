import { translate } from '@/i18n/i18n'
import { formatBytes } from '../status-bar/workspace-space-format'
import type { SftpEntry } from '../../../../shared/sftp-types'

export type SftpColumnId = 'name' | 'size' | 'created' | 'modified' | 'type' | 'owner'

/** Every column but the name can be hidden. */
export const TOGGLEABLE_SFTP_COLUMNS: readonly SftpColumnId[] = [
  'size',
  'created',
  'modified',
  'type',
  'owner'
]

// Why: mirrors the width classes in SftpFileRow so a narrow pane scrolls instead of hiding names.
const COLUMN_WIDTH_REM: Record<SftpColumnId, number> = {
  name: 10,
  size: 5,
  created: 8,
  modified: 8,
  type: 6,
  owner: 5
}
const ROW_PADDING_REM = 1.5
const ICON_REM = 0.875
const GAP_REM = 0.75

export function sftpListMinWidthRem(columns: readonly SftpColumnId[]): number {
  const cells = columns.reduce((total, column) => total + COLUMN_WIDTH_REM[column], 0)
  return ROW_PADDING_REM + ICON_REM + cells + GAP_REM * columns.length
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
const NO_VALUE = '—'

export function sftpColumnLabel(column: SftpColumnId): string {
  switch (column) {
    case 'name':
      return translate('sftpPage.column.name', 'Name')
    case 'size':
      return translate('sftpPage.column.size', 'Size')
    case 'created':
      return translate('sftpPage.column.created', 'Created')
    case 'modified':
      return translate('sftpPage.column.modified', 'Modified')
    case 'type':
      return translate('sftpPage.column.type', 'Type')
    case 'owner':
      return translate('sftpPage.column.owner', 'Owner')
  }
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  // Why: ".bashrc" is a hidden name, not an extension.
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : null
}

export function sftpEntryTypeLabel(entry: SftpEntry): string {
  switch (entry.kind) {
    case 'directory':
      return translate('sftpPage.type.folder', 'Folder')
    case 'symlink':
      return translate('sftpPage.type.link', 'Link')
    case 'other':
      return translate('sftpPage.type.other', 'Special file')
    case 'file': {
      const extension = extensionOf(entry.name)
      return extension
        ? translate('sftpPage.type.fileWithExtension', '{{ext}} file', { ext: extension })
        : translate('sftpPage.type.file', 'File')
    }
  }
}

export function sftpCellText(column: SftpColumnId, entry: SftpEntry): string {
  switch (column) {
    case 'name':
      return entry.name
    case 'size':
      return entry.kind === 'directory' ? NO_VALUE : formatBytes(entry.size)
    case 'created':
      return entry.createdMs === null ? NO_VALUE : DATE_FORMAT.format(entry.createdMs)
    case 'modified':
      return DATE_FORMAT.format(entry.modifiedMs)
    case 'type':
      return sftpEntryTypeLabel(entry)
    case 'owner':
      return entry.owner ?? NO_VALUE
  }
}
