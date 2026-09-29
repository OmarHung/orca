import type { RefObject } from 'react'
import { CornerLeftUp, File, FileSymlink, Folder, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { translate } from '@/i18n/i18n'
import { formatBytes } from '../status-bar/workspace-space-format'
import type { SftpEntry } from '../../../../shared/sftp-types'
import { selectionModifiersFromEvent } from './sftp-selection'
import type { SftpPaneState } from './use-sftp-pane'

const MODIFIED_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
  timeStyle: 'short'
})
const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

type SftpFilePaneProps = {
  title: string
  pane: SftpPaneState
  onOpen: (entry: SftpEntry) => void
  leading?: React.ReactNode
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

function EntryIcon({ kind }: { kind: SftpEntry['kind'] }): React.JSX.Element {
  const Icon = kind === 'directory' ? Folder : kind === 'symlink' ? FileSymlink : File
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />
}

export function SftpFilePane({
  title,
  pane,
  onOpen,
  leading,
  actions,
  dropZoneRef,
  isDropTarget,
  dropHint
}: SftpFilePaneProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        {leading}
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
          disabled={pane.path === null}
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
        {actions}
      </div>
      <div
        ref={dropZoneRef}
        role="listbox"
        aria-multiselectable
        aria-label={title}
        data-drop-active={isDropTarget ? 'true' : undefined}
        className="scrollbar-sleek relative min-h-0 flex-1 overflow-y-auto py-1 data-[drop-active=true]:bg-accent"
      >
        {pane.status === 'loading' && pane.path === null ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {translate('sftpPage.pane.connecting', 'Connecting…')}
          </p>
        ) : pane.status === 'error' ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground">{pane.error}</p>
            <Button variant="outline" size="xs" onClick={pane.refresh}>
              {translate('sftpPage.pane.retry', 'Retry')}
            </Button>
          </div>
        ) : pane.entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {dropHint ?? translate('sftpPage.pane.empty', 'This folder is empty.')}
          </p>
        ) : (
          pane.entries.map((entry) => {
            const isSelected = pane.selection.selected.has(entry.path)
            return (
              <div
                key={entry.path}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                data-selected={isSelected ? 'true' : undefined}
                data-sftp-entry={entry.path}
                onClick={(event) => pane.select(entry, selectionModifiersFromEvent(event, IS_MAC))}
                onDoubleClick={() => onOpen(entry)}
                className="flex cursor-default items-center gap-2 px-3 py-1 text-[13px] select-none hover:bg-accent data-[selected=true]:bg-accent"
              >
                <EntryIcon kind={entry.kind} />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {entry.kind === 'directory' ? '' : formatBytes(entry.size)}
                </span>
                <span className="w-32 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {MODIFIED_FORMAT.format(entry.modifiedMs)}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
