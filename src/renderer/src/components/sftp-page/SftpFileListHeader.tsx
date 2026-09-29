import { ChevronDown, ChevronUp, Columns3 } from 'lucide-react'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { translate } from '@/i18n/i18n'
import { sftpColumnLabel, TOGGLEABLE_SFTP_COLUMNS, type SftpColumnId } from './sftp-columns'
import { useSftpColumnsStore, type SftpPaneId } from './sftp-columns-store'
import { nextSftpSort } from './sftp-entry-sort'

// Widths match the row cells in SftpFileRow.
const HEADER_CELL_CLASS: Record<SftpColumnId, string> = {
  name: 'flex min-w-40 flex-1 items-center gap-1 text-left hover:text-foreground',
  size: 'flex w-20 shrink-0 items-center justify-end gap-1 hover:text-foreground',
  created: 'flex w-32 shrink-0 items-center justify-end gap-1 hover:text-foreground',
  modified: 'flex w-32 shrink-0 items-center justify-end gap-1 hover:text-foreground',
  type: 'flex w-24 shrink-0 items-center gap-1 text-left hover:text-foreground',
  owner: 'flex w-20 shrink-0 items-center gap-1 text-left hover:text-foreground'
}

/** Sortable column titles; sticky so they stay put while scrolling either way. */
export function SftpFileListHeader({
  pane,
  columns
}: {
  pane: SftpPaneId
  columns: readonly SftpColumnId[]
}): React.JSX.Element {
  const sort = useSftpColumnsStore((s) => s.sortByPane[pane])
  const setSort = useSftpColumnsStore((s) => s.setSort)
  const SortIcon = sort.direction === 'asc' ? ChevronUp : ChevronDown

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-3 py-1 text-xs text-muted-foreground select-none">
      <span className="w-3.5 shrink-0" />
      {columns.map((column) => {
        const isSorted = sort.column === column
        return (
          <button
            key={column}
            type="button"
            data-sftp-column={column}
            data-sort={isSorted ? sort.direction : undefined}
            className={HEADER_CELL_CLASS[column]}
            onClick={() => setSort(pane, nextSftpSort(sort, column))}
          >
            <span className="truncate">{sftpColumnLabel(column)}</span>
            {isSorted ? <SortIcon className="size-3 shrink-0" /> : null}
          </button>
        )
      })}
    </div>
  )
}

/** Toolbar menu that shows or hides the optional columns in both panes. */
export function SftpColumnsMenu(): React.JSX.Element {
  const hiddenColumns = useSftpColumnsStore((s) => s.hiddenColumns)
  const toggleColumn = useSftpColumnsStore((s) => s.toggleColumn)
  const label = translate('sftpPage.column.menu', 'Show columns')

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={label}>
              <Columns3 className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {TOGGLEABLE_SFTP_COLUMNS.map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={!hiddenColumns.includes(column)}
            // Why: keep the menu open so several columns can be toggled in one go.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => toggleColumn(column)}
          >
            {sftpColumnLabel(column)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
