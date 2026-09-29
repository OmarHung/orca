import { createElement } from 'react'
import { File, FileSymlink, Folder, FolderUp, type LucideIcon } from 'lucide-react'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { getFolderTypeIcon } from '@/lib/folder-type-icons'
import type { SftpEntry } from '../../../../shared/sftp-types'
import {
  sftpCellText,
  sftpFileExtension,
  type SftpColumnId,
  type SftpColumnWidths
} from './sftp-columns'
import { MAX_SFTP_EXTENSION_LABEL_LENGTH, SftpExtensionIcon } from './SftpExtensionIcon'

const CELL_CLASS: Record<SftpColumnId, string> = {
  name: 'shrink-0 truncate px-1.5',
  size: 'shrink-0 truncate px-1.5 text-right text-xs text-muted-foreground tabular-nums',
  created: 'shrink-0 truncate px-1.5 text-right text-xs text-muted-foreground tabular-nums',
  modified: 'shrink-0 truncate px-1.5 text-right text-xs text-muted-foreground tabular-nums',
  type: 'shrink-0 truncate px-1.5 text-xs text-muted-foreground',
  owner: 'shrink-0 truncate px-1.5 text-xs text-muted-foreground'
}

const ICON_CLASS = 'mr-2 size-4 shrink-0 text-muted-foreground'

const ROW_CLASS =
  'flex cursor-default items-center px-3 py-1 text-[13px] select-none hover:bg-accent data-[drop-target=true]:bg-accent data-[drop-target=true]:ring-1 data-[drop-target=true]:ring-ring data-[drop-target=true]:ring-inset data-[selected=true]:bg-accent'

/** Where a moved row lands; only rows with a `dropDir` accept a drop. */
type RowDropProps = { dropDir?: string; isDropTarget?: boolean }

function typeIcon({ kind, name }: SftpEntry): LucideIcon {
  switch (kind) {
    case 'directory':
      return getFolderTypeIcon(name) ?? Folder
    case 'symlink':
      return FileSymlink
    case 'file':
      return getFileTypeIcon(name)
    case 'other':
      return File
  }
}

function EntryIcon({ entry }: { entry: SftpEntry }): React.JSX.Element {
  const extension = entry.kind === 'file' ? sftpFileExtension(entry.name) : null
  if (extension && extension.length <= MAX_SFTP_EXTENSION_LABEL_LENGTH) {
    return <SftpExtensionIcon extension={extension} className={ICON_CLASS} />
  }
  return createElement(typeIcon(entry), { className: ICON_CLASS })
}

export function SftpFileRow({
  entry,
  columns,
  widths,
  isSelected,
  isDraggable,
  dropDir,
  isDropTarget,
  onClick,
  onDoubleClick,
  onContextMenu
}: RowDropProps & {
  entry: SftpEntry
  columns: readonly SftpColumnId[]
  widths: SftpColumnWidths
  isSelected: boolean
  isDraggable?: boolean
  onClick: (event: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu?: () => void
}): React.JSX.Element {
  return (
    <div
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
      draggable={isDraggable}
      data-selected={isSelected ? 'true' : undefined}
      data-sftp-entry={entry.path}
      data-sftp-drop-dir={dropDir}
      data-drop-target={isDropTarget ? 'true' : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={ROW_CLASS}
    >
      <EntryIcon entry={entry} />
      {columns.map((column) => {
        const text = sftpCellText(column, entry)
        return (
          <span
            key={column}
            className={CELL_CLASS[column]}
            style={{ width: widths[column] }}
            // Why: a narrowed column truncates; hovering shows the whole value.
            title={text}
          >
            {text}
          </span>
        )
      })}
    </div>
  )
}

/** The ".." row: double-click goes to the parent folder. Never selectable. */
export function SftpParentRow({
  label,
  dropDir,
  isDropTarget,
  onOpen
}: RowDropProps & {
  label: string
  onOpen: () => void
}): React.JSX.Element {
  return (
    <div
      role="option"
      aria-selected={false}
      aria-label={label}
      tabIndex={-1}
      data-sftp-parent
      data-sftp-drop-dir={dropDir}
      data-drop-target={isDropTarget ? 'true' : undefined}
      onDoubleClick={onOpen}
      className={ROW_CLASS}
    >
      <FolderUp className={ICON_CLASS} />
      <span className="truncate px-1.5">..</span>
    </div>
  )
}
