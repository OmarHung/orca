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

export type SftpColumnWidths = Record<SftpColumnId, number>

export const DEFAULT_SFTP_COLUMN_WIDTHS: SftpColumnWidths = {
  name: 240,
  size: 80,
  created: 136,
  modified: 136,
  type: 104,
  owner: 88
}
export const MIN_SFTP_COLUMN_WIDTH = 48
export const MAX_SFTP_COLUMN_WIDTH = 1200

export function clampSftpColumnWidth(width: number): number {
  return Math.round(Math.min(MAX_SFTP_COLUMN_WIDTH, Math.max(MIN_SFTP_COLUMN_WIDTH, width)))
}

// Why: row padding (px-3) plus the icon and its margin; keeps header and rows the same width.
const ROW_CHROME_PX = 24 + 16 + 8

/** Full row width, so a narrow pane scrolls sideways instead of squeezing columns. */
export function sftpRowWidthPx(columns: readonly SftpColumnId[], widths: SftpColumnWidths): number {
  return columns.reduce((total, column) => total + widths[column], ROW_CHROME_PX)
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

/** A file's extension in capitals, as the Type column and the file icon show it. */
export function sftpFileExtension(name: string): string | null {
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
      const extension = sftpFileExtension(entry.name)
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
