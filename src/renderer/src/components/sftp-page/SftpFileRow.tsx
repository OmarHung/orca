import { File, FileSymlink, Folder, FolderUp } from 'lucide-react'
import type { SftpEntry } from '../../../../shared/sftp-types'
import { sftpCellText, type SftpColumnId, type SftpColumnWidths } from './sftp-columns'

const CELL_CLASS: Record<SftpColumnId, string> = {
  name: 'shrink-0 truncate px-1.5',
  size: 'shrink-0 truncate px-1.5 text-right text-xs text-muted-foreground tabular-nums',
  created: 'shrink-0 truncate px-1.5 text-right text-xs text-muted-foreground tabular-nums',
  modified: 'shrink-0 truncate px-1.5 text-right text-xs text-muted-foreground tabular-nums',
  type: 'shrink-0 truncate px-1.5 text-xs text-muted-foreground',
  owner: 'shrink-0 truncate px-1.5 text-xs text-muted-foreground'
}

const ROW_CLASS =
  'flex cursor-default items-center px-3 py-1 text-[13px] select-none hover:bg-accent data-[selected=true]:bg-accent'

function EntryIcon({ kind }: { kind: SftpEntry['kind'] }): React.JSX.Element {
  const Icon = kind === 'directory' ? Folder : kind === 'symlink' ? FileSymlink : File
  return <Icon className="mr-2 size-3.5 shrink-0 text-muted-foreground" />
}

export function SftpFileRow({
  entry,
  columns,
  widths,
  isSelected,
  onClick,
  onDoubleClick
}: {
  entry: SftpEntry
  columns: readonly SftpColumnId[]
  widths: SftpColumnWidths
  isSelected: boolean
  onClick: (event: React.MouseEvent) => void
  onDoubleClick: () => void
}): React.JSX.Element {
  return (
    <div
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
      data-selected={isSelected ? 'true' : undefined}
      data-sftp-entry={entry.path}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={ROW_CLASS}
    >
      <EntryIcon kind={entry.kind} />
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
  onOpen
}: {
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
      onDoubleClick={onOpen}
      className={ROW_CLASS}
    >
      <FolderUp className="mr-2 size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate px-1.5">..</span>
    </div>
  )
}
