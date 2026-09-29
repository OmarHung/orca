import { useMemo, type RefObject } from 'react'
import { CornerLeftUp, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { SftpEntry } from '../../../../shared/sftp-types'
import { sftpRowWidthPx, TOGGLEABLE_SFTP_COLUMNS, type SftpColumnId } from './sftp-columns'
import { useSftpColumnsStore, type SftpPaneId } from './sftp-columns-store'
import { sortSftpEntriesBy } from './sftp-entry-sort'
import { SftpColumnsMenu, SftpFileListHeader } from './SftpFileListHeader'
import { SftpFileRow, SftpParentRow } from './SftpFileRow'
import { selectionModifiersFromEvent } from './sftp-selection'
import type { SftpPaneDrag } from './use-sftp-pane-drag'
import type { SftpPaneState } from './use-sftp-pane'

const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
const PLAIN_CLICK = { toggle: false, range: false }

type SftpFilePaneProps = {
  paneId: SftpPaneId
  title: string
  pane: SftpPaneState
  onOpen: (entry: SftpEntry) => void
  actions?: React.ReactNode
  dropZoneRef?: RefObject<HTMLDivElement | null>
  isDropTarget?: boolean
  dropHint?: string
  /** Drag rows to the other pane, or onto a folder row or the ".." row. */
  drag?: SftpPaneDrag
  /** Items of the right-click menu; right-clicking an unselected row selects it first. */
  contextMenu?: React.ReactNode
}

function PaneIconButton(props: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={props.label}
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  )
}

export { PaneIconButton }

function useDisplayedEntries(
  paneId: SftpPaneId,
  entries: SftpEntry[]
): { columns: SftpColumnId[]; sorted: SftpEntry[]; orderedPaths: string[] } {
  const sort = useSftpColumnsStore((s) => s.sortByPane[paneId])
  const hiddenColumns = useSftpColumnsStore((s) => s.hiddenColumns)
  return useMemo(() => {
    const sorted = sortSftpEntriesBy(entries, sort)
    return {
      columns: [
        'name',
        ...TOGGLEABLE_SFTP_COLUMNS.filter((column) => !hiddenColumns.includes(column))
      ],
      sorted,
      orderedPaths: sorted.map((entry) => entry.path)
    }
  }, [entries, sort, hiddenColumns])
}

function PaneContextMenu({
  items,
  children
}: {
  items: React.ReactNode
  children: React.JSX.Element
}): React.JSX.Element {
  if (!items) {
    return children
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>{items}</ContextMenuContent>
    </ContextMenu>
  )
}

function PaneMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-4 py-6 text-center text-xs text-muted-foreground">{children}</p>
}

export function SftpFilePane({
  paneId,
  title,
  pane,
  onOpen,
  actions,
  dropZoneRef,
  isDropTarget,
  dropHint,
  drag,
  contextMenu
}: SftpFilePaneProps): React.JSX.Element {
  const { columns, sorted, orderedPaths } = useDisplayedEntries(paneId, pane.entries)
  const widths = useSftpColumnsStore((s) => s.columnWidths)

  return (
    <div data-sftp-pane={paneId} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="max-w-32 shrink-0 truncate text-xs font-medium text-muted-foreground">
          {title}
        </span>
        {/* Why: the Input primitive is h-9/text-sm; this matches the h-6 xs toolbar buttons, like Git Log's filter. */}
        <div className="flex h-6 min-w-0 flex-1 items-center rounded-md border border-input px-2 focus-within:border-ring">
          <input
            key={pane.path ?? ''}
            type="text"
            defaultValue={pane.path ?? ''}
            aria-label={translate('sftpPage.pane.path', 'Path')}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.currentTarget.value.trim()) {
                pane.navigate(event.currentTarget.value.trim())
              }
            }}
          />
        </div>
        <PaneIconButton
          label={translate('sftpPage.pane.up', 'Parent folder')}
          disabled={pane.parentPath === null}
          onClick={pane.goUp}
        >
          <CornerLeftUp className="size-3.5" />
        </PaneIconButton>
        <PaneIconButton
          label={translate('sftpPage.pane.refresh', 'Refresh')}
          onClick={pane.refresh}
        >
          <RefreshCw className="size-3.5" />
        </PaneIconButton>
        <SftpColumnsMenu />
        {actions}
      </div>
      <PaneContextMenu items={contextMenu}>
        <div
          ref={dropZoneRef}
          data-sftp-drop-zone
          data-drop-active={isDropTarget || drag?.isPaneTarget ? 'true' : undefined}
          className="scrollbar-sleek relative min-h-0 flex-1 overflow-auto data-[drop-active=true]:bg-accent"
          {...drag?.handlers}
        >
          {pane.status === 'loading' && pane.path === null ? (
            <PaneMessage>{translate('sftpPage.pane.connecting', 'Connecting…')}</PaneMessage>
          ) : pane.status === 'error' ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <p className="text-xs text-muted-foreground">{pane.error}</p>
              <Button variant="outline" size="xs" onClick={pane.refresh}>
                {translate('sftpPage.pane.retry', 'Retry')}
              </Button>
            </div>
          ) : (
            <div style={{ minWidth: sftpRowWidthPx(columns, widths) }}>
              <SftpFileListHeader pane={paneId} columns={columns} />
              <div role="listbox" aria-multiselectable aria-label={title} className="py-1">
                {pane.parentPath !== null ? (
                  <SftpParentRow
                    label={translate('sftpPage.pane.up', 'Parent folder')}
                    dropDir={drag ? pane.parentPath : undefined}
                    isDropTarget={drag?.dropTarget === pane.parentPath}
                    onOpen={pane.goUp}
                  />
                ) : null}
                {sorted.length === 0 ? (
                  <PaneMessage>
                    {dropHint ?? translate('sftpPage.pane.empty', 'This folder is empty.')}
                  </PaneMessage>
                ) : (
                  sorted.map((entry) => (
                    <SftpFileRow
                      key={entry.path}
                      entry={entry}
                      columns={columns}
                      widths={widths}
                      isSelected={pane.selection.selected.has(entry.path)}
                      isDraggable={drag !== undefined}
                      dropDir={drag && entry.kind === 'directory' ? entry.path : undefined}
                      isDropTarget={drag?.dropTarget === entry.path}
                      onClick={(event) =>
                        pane.select(entry, selectionModifiersFromEvent(event, IS_MAC), orderedPaths)
                      }
                      onDoubleClick={() => onOpen(entry)}
                      onContextMenu={
                        contextMenu && !pane.selection.selected.has(entry.path)
                          ? () => pane.select(entry, PLAIN_CLICK, orderedPaths)
                          : undefined
                      }
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </PaneContextMenu>
    </div>
  )
}
