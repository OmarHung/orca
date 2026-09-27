import React from 'react'
import {
  ChevronRight,
  Columns3,
  Database,
  Eye,
  KeyRound,
  Layers,
  Loader2,
  Table2
} from 'lucide-react'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isServerConnection } from '../../../../../shared/database/database-connection-types'
import { cn } from '@/lib/utils'
import { DatabaseSessionDot } from '../DatabaseConnectionBadge'
import { useDatabaseConnectionColor } from '../database-connection-color'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import { DatabaseExplorerContextMenu } from './DatabaseExplorerContextMenu'
import {
  isExpandableNode,
  type DatabaseExplorerNode,
  type DatabaseExplorerRow as ExplorerRow
} from './database-explorer-tree'

export const EXPLORER_ROW_HEIGHT = 24
const INDENT_PX = 12

const ICON_CLASS = 'size-3.5 shrink-0 text-muted-foreground'

function ConnectionIcon({ connectionId }: { connectionId: string }): React.JSX.Element {
  const color = useDatabaseConnectionColor(connectionId)
  return <Database className={ICON_CLASS} style={color ? { color } : undefined} />
}

function NodeIcon({ node }: { node: DatabaseExplorerNode }): React.JSX.Element {
  switch (node.kind) {
    case 'connection':
      return <ConnectionIcon connectionId={node.connectionId} />
    case 'schema':
      return <Layers className={ICON_CLASS} />
    case 'relation':
      return node.relation.kind === 'view' || node.relation.kind === 'materialized-view' ? (
        <Eye className={ICON_CLASS} />
      ) : (
        <Table2 className={ICON_CLASS} />
      )
    case 'column':
      return node.column.isPrimaryKey ? (
        <KeyRound className={ICON_CLASS} />
      ) : (
        <Columns3 className={ICON_CLASS} />
      )
  }
}

function ConnectionLabel({ connectionId }: { connectionId: string }): React.JSX.Element {
  const connection = useDatabaseConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === connectionId)
  )
  const session = useDatabaseConnectionsStore((state) => state.sessions[connectionId])
  const sshTargetId =
    connection && isServerConnection(connection) ? connection.sshTunnel?.targetId : undefined
  const sshLabel = useAppStore((state) =>
    sshTargetId ? (state.sshTargetLabels.get(sshTargetId) ?? null) : undefined
  )
  return (
    <>
      <span className="truncate">{connection?.name ?? ''}</span>
      {sshLabel !== undefined ? (
        <span className="truncate text-muted-foreground">
          {translate('database.explorer.viaSsh', 'via {{value0}}', {
            value0: sshLabel ?? translate('database.connectionForm.sshRemoved', 'Removed SSH host')
          })}
        </span>
      ) : null}
      <DatabaseSessionDot state={session?.state ?? 'disconnected'} />
      {session?.state === 'error' && session.message ? (
        <span className="truncate text-destructive" title={session.message}>
          {session.message}
        </span>
      ) : null}
    </>
  )
}

function NodeLabel({ node }: { node: DatabaseExplorerNode }): React.JSX.Element {
  switch (node.kind) {
    case 'connection':
      return <ConnectionLabel connectionId={node.connectionId} />
    case 'schema':
      return <span className="truncate">{node.schema}</span>
    case 'relation':
      return <span className="truncate">{node.relation.name}</span>
    case 'column':
      return (
        <>
          <span className="truncate">{node.column.name}</span>
          <span className="truncate text-muted-foreground">
            {node.column.dataType}
            {node.column.nullable ? '' : ` ${translate('database.explorer.notNull', 'not null')}`}
          </span>
        </>
      )
  }
}

function StatusRow({ row }: { row: Extract<ExplorerRow, { type: 'status' }> }): React.JSX.Element {
  return (
    <div
      className="flex h-full items-center gap-1.5 truncate text-xs text-muted-foreground"
      style={{ paddingLeft: row.depth * INDENT_PX + 26 }}
    >
      {row.status === 'loading' ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          {translate('database.explorer.loading', 'Loading…')}
        </>
      ) : null}
      {row.status === 'empty' ? translate('database.explorer.empty', 'No objects') : null}
      {row.status === 'error' ? (
        <span className="truncate text-destructive" title={row.message}>
          {row.message}
        </span>
      ) : null}
    </div>
  )
}

export function DatabaseExplorerRow({
  row,
  selected,
  onSelect,
  onToggle,
  onActivate
}: {
  row: ExplorerRow
  selected: boolean
  onSelect: (key: string) => void
  onToggle: (node: DatabaseExplorerNode) => void
  /** Double-click: opens a table's data, expands anything else. */
  onActivate: (node: DatabaseExplorerNode) => void
}): React.JSX.Element {
  if (row.type === 'status') {
    return <StatusRow row={row} />
  }
  const { node } = row
  const expandable = isExpandableNode(node)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-level={row.depth + 1}
          aria-expanded={expandable ? row.expanded : undefined}
          aria-selected={selected}
          data-current={selected ? 'true' : undefined}
          onMouseDown={() => onSelect(row.key)}
          onDoubleClick={() => onActivate(node)}
          className={cn(
            'flex h-full cursor-default items-center gap-1 pr-2 text-xs hover:bg-accent',
            selected && 'bg-accent'
          )}
          style={{ paddingLeft: row.depth * INDENT_PX + 4 }}
        >
          {/* Why aria-hidden: the row's aria-expanded already says this, and it takes no focus. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => onToggle(node)}
            className={cn(
              'flex size-4 shrink-0 items-center justify-center',
              !expandable && 'invisible'
            )}
          >
            <ChevronRight
              className={cn('size-3 transition-transform', row.expanded && 'rotate-90')}
            />
          </button>
          <NodeIcon node={node} />
          <span className="flex min-w-0 items-center gap-1.5">
            <NodeLabel node={node} />
          </span>
        </div>
      </ContextMenuTrigger>
      <DatabaseExplorerContextMenu node={node} />
    </ContextMenu>
  )
}
