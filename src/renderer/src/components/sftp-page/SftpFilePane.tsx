import { useMemo, type RefObject } from 'react'
import { CornerLeftUp, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { SftpEntry } from '../../../../shared/sftp-types'
import { sftpRowWidthPx, TOGGLEABLE_SFTP_COLUMNS, type SftpColumnId } from './sftp-columns'
import { useSftpColumnsStore, type SftpPaneId } from './sftp-columns-store'
import { sortSftpEntriesBy } from './sftp-entry-sort'
import { SftpColumnsMenu, SftpFileListHeader } from './SftpFileListHeader'
import { SftpFileRow, SftpParentRow } from './SftpFileRow'
import { selectionModifiersFromEvent } from './sftp-selection'
import type { SftpPaneState } from './use-sftp-pane'

const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

type SftpFilePaneProps = {
  paneId: SftpPaneId
  title: string
  pane: SftpPaneState
  onOpen: (entry: SftpEntry) => void
  actions?: React.ReactNode
  dropZoneRef?: RefObject<HTMLDivElement | null>
  isDropTarget?: boolean
  dropHint?: string
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
  dropHint
}: SftpFilePaneProps): React.JSX.Element {
  const { columns, sorted, orderedPaths } = useDisplayedEntries(paneId, pane.entries)
  const widths = useSftpColumnsStore((s) => s.columnWidths)

  return (
    <div data-sftp-pane={paneId} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="max-w-32 shrink-0 truncate text-xs font-medium text-muted-foreground">
          {title}
        </span>
        <Input
          key={pane.path ?? ''}
          defaultValue={pane.path ?? ''}
          aria-label={translate('sftpPage.pane.path', 'Path')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.currentTarget.value.trim()) {
              pane.navigate(event.currentTarget.value.trim())
            }
          }}
        />
        <PaneIconButton
          label={translate('sftpPage.pane.up', 'Parent folder')}
          disabled={!pane.hasParent}
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
      <div
        ref={dropZoneRef}
        data-drop-active={isDropTarget ? 'true' : undefined}
        className="scrollbar-sleek relative min-h-0 flex-1 overflow-auto data-[drop-active=true]:bg-accent"
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
              {pane.hasParent ? (
                <SftpParentRow
                  label={translate('sftpPage.pane.up', 'Parent folder')}
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
                    onClick={(event) =>
                      pane.select(entry, selectionModifiersFromEvent(event, IS_MAC), orderedPaths)
                    }
                    onDoubleClick={() => onOpen(entry)}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
