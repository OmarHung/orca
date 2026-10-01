import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { SshTarget } from '../../../../shared/ssh-types'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { formatSshTargetEndpoint } from '../settings/ssh-target-search'
import { SshHostVpnBadge, SshHostVpnMenu } from '../ssh-vpn/SshHostVpnMenu'
import type { SshHostDrop } from './ssh-host-drop-target'
import { sshHostGroupActions } from './ssh-host-groups-store'
import { UNGROUPED_SECTION_ID } from './ssh-host-groups'
import type { SshHostTreeRow } from './ssh-host-tree'
import {
  SshHostGroupMenuContent,
  SshHostMoveToGroupSubmenu,
  type AskSshHostGroupName
} from './SshHostGroupMenus'

const ROW_START_PADDING_PX = 8
const INDENT_PX = 14

function indentStyle(depth: number): React.CSSProperties {
  return { paddingLeft: ROW_START_PADDING_PX + depth * INDENT_PX }
}

const HEADING_ROW_CLASS =
  'relative flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] transition-colors hover:bg-accent data-[drop=inside]:bg-accent data-[drop=inside]:ring-1 data-[drop=inside]:ring-inset data-[drop=inside]:ring-ring'

function dropAttribute(row: SshHostTreeRow, drop: SshHostDrop | null): string | undefined {
  return drop?.indicatorKey === row.key ? drop.indicator : undefined
}

/** The line a dragged group would be placed at, above or below this row. */
function ReorderLine({ position }: { position: string | undefined }): React.JSX.Element | null {
  if (position !== 'before' && position !== 'after') {
    return null
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-ring',
        position === 'before' ? 'top-0' : 'bottom-0'
      )}
    />
  )
}

function Chevron({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <ChevronRight
      className={cn(
        'size-3 shrink-0 text-muted-foreground transition-transform',
        expanded && 'rotate-90'
      )}
    />
  )
}

export function SshHostGroupRow({
  row,
  drop,
  isSearching,
  onAskName
}: {
  row: Extract<SshHostTreeRow, { kind: 'group' }>
  drop: SshHostDrop | null
  /** A search unfolds every group with matches, so folding waits until it ends. */
  isSearching: boolean
  onAskName: AskSshHostGroupName
}): React.JSX.Element {
  const position = dropAttribute(row, drop)
  const Icon = row.expanded ? FolderOpen : Folder
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          draggable
          data-ssh-tree-row={row.key}
          data-ssh-host-group={row.group.id}
          data-drop={position}
          aria-expanded={row.expanded}
          onClick={() => {
            if (!isSearching) {
              sshHostGroupActions.setCollapsed(row.group.id, row.expanded)
            }
          }}
          className={cn(HEADING_ROW_CLASS, 'font-medium text-foreground')}
          style={indentStyle(row.depth)}
        >
          <Chevron expanded={row.expanded} />
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{row.group.name}</span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground">
            {row.hostCount}
          </span>
          <ReorderLine position={position} />
        </button>
      </ContextMenuTrigger>
      <SshHostGroupMenuContent group={row.group} onAskName={onAskName} />
    </ContextMenu>
  )
}

/** Heading of the hosts outside every group; also where hosts are dragged to leave one. */
export function SshHostUngroupedRow({
  row,
  drop,
  isSearching
}: {
  row: Extract<SshHostTreeRow, { kind: 'ungrouped' }>
  drop: SshHostDrop | null
  isSearching: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-ssh-tree-row={row.key}
      data-ssh-host-ungrouped=""
      data-drop={dropAttribute(row, drop)}
      aria-expanded={row.expanded}
      onClick={() => {
        if (!isSearching) {
          sshHostGroupActions.setCollapsed(UNGROUPED_SECTION_ID, row.expanded)
        }
      }}
      className={cn(HEADING_ROW_CLASS, 'text-muted-foreground')}
      style={indentStyle(0)}
    >
      <Chevron expanded={row.expanded} />
      <span className="min-w-0 flex-1 truncate">
        {translate('sshPage.groups.ungrouped', 'Ungrouped')}
      </span>
      <span className="shrink-0 text-xs">{row.hostCount}</span>
    </button>
  )
}

export function SshHostRow({
  row,
  isCurrent,
  onSelect,
  menuItems,
  onAskName
}: {
  row: Extract<SshHostTreeRow, { kind: 'host' }>
  isCurrent: boolean
  onSelect: (target: SshTarget) => void
  /** Page-specific actions, listed first in the row's right-click menu. */
  menuItems?: React.ReactNode
  onAskName: AskSshHostGroupName
}): React.JSX.Element {
  const { target } = row
  return (
    <SshHostVpnMenu
      targetId={target.id}
      leadingItems={
        <>
          {menuItems}
          <SshHostMoveToGroupSubmenu targetId={target.id} onAskName={onAskName} />
        </>
      }
    >
      <button
        type="button"
        draggable
        data-ssh-tree-row={row.key}
        data-ssh-host-row={target.id}
        data-current={isCurrent ? 'true' : undefined}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={() => onSelect(target)}
        className="flex w-full flex-col items-start gap-0.5 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent data-[current=true]:bg-accent"
        style={indentStyle(row.depth)}
      >
        <span className="flex w-full items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {target.label}
          </span>
          <SshHostVpnBadge targetId={target.id} />
        </span>
        <span className="w-full truncate text-xs text-muted-foreground">
          {formatSshTargetEndpoint(target)}
        </span>
      </button>
    </SshHostVpnMenu>
  )
}
