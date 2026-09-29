import React, { useLayoutEffect, useRef } from 'react'
import {
  ChevronRight,
  Columns3,
  Cylinder,
  Database,
  Eye,
  Folder,
  FolderOpen,
  Key,
  KeyRound,
  Layers,
  Link2,
  ListOrdered,
  Loader2,
  SquareFunction,
  Table2,
  Workflow
} from 'lucide-react'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { DatabaseSessionDot } from '../DatabaseConnectionBadge'
import { useDatabaseConnectionColor } from '../database-connection-color'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import { DatabaseExplorerContextMenu } from './DatabaseExplorerContextMenu'
import { DatabaseExplorerGroupContextMenu } from './DatabaseExplorerGroupMenus'
import { commentLine, constraintLabel, folderLabel } from './database-explorer-labels'
import { useConnectionRouteLabel } from './use-connection-route-label'
import type { DatabaseExplorerRow as ExplorerRow } from './database-explorer-rows'
import { isExpandableNode, type DatabaseExplorerNode } from './database-explorer-tree'

export const EXPLORER_ROW_HEIGHT = 24
const ROW_END_PADDING = 8
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
    case 'database':
      return <Cylinder className={ICON_CLASS} />
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
    case 'folder':
      return <Folder className={ICON_CLASS} />
    case 'routine':
      return node.routine.kind === 'procedure' ? (
        <Workflow className={ICON_CLASS} />
      ) : (
        <SquareFunction className={ICON_CLASS} />
      )
    case 'constraint':
      if (node.constraint.kind === 'foreign') {
        return <Link2 className={ICON_CLASS} />
      }
      return node.constraint.kind === 'primary' ? (
        <KeyRound className={ICON_CLASS} />
      ) : (
        <Key className={ICON_CLASS} />
      )
    case 'index':
      return <ListOrdered className={ICON_CLASS} />
  }
}

function ConnectionLabel({ connectionId }: { connectionId: string }): React.JSX.Element {
  const connection = useDatabaseConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === connectionId)
  )
  const session = useDatabaseConnectionsStore((state) => state.sessions[connectionId])
  const routeLabel = useConnectionRouteLabel(connection)
  return (
    <>
      <span>{connection?.name ?? ''}</span>
      {routeLabel ? <span className="text-muted-foreground">{routeLabel}</span> : null}
      <DatabaseSessionDot state={session?.state ?? 'disconnected'} />
      {/* Why capped: a long error would widen the whole tree; the title keeps all of it. */}
      {session?.state === 'error' && session.message ? (
        <span className="max-w-80 truncate text-destructive" title={session.message}>
          {session.message}
        </span>
      ) : null}
    </>
  )
}

// Why capped: a long comment would widen the whole tree; the title keeps all of it.
function CommentText({ comment }: { comment: string | null }): React.JSX.Element | null {
  return comment ? (
    <span className="max-w-80 truncate text-muted-foreground/70" title={comment}>
      {commentLine(comment)}
    </span>
  ) : null
}

// Shown whole: the tree scrolls sideways rather than cut a name or type short.
function NodeLabel({ node }: { node: DatabaseExplorerNode }): React.JSX.Element {
  switch (node.kind) {
    case 'connection':
      return <ConnectionLabel connectionId={node.connectionId} />
    case 'database':
      return <span>{node.database}</span>
    case 'schema':
      return <span>{node.schema}</span>
    case 'relation':
      return (
        <>
          <span>{node.relation.name}</span>
          <CommentText comment={node.relation.comment} />
        </>
      )
    case 'column':
      return (
        <>
          <span>{node.column.name}</span>
          <span className="text-muted-foreground">
            {node.column.dataType}
            {node.column.nullable ? '' : ` ${translate('database.explorer.notNull', 'not null')}`}
          </span>
          <CommentText comment={node.column.comment} />
        </>
      )
    case 'folder':
      return <span>{folderLabel(node.folder)}</span>
    case 'routine':
      return (
        <>
          <span>{node.routine.name}</span>
          <span className="text-muted-foreground">({node.routine.arguments})</span>
        </>
      )
    case 'constraint': {
      const label = constraintLabel(node.constraint)
      return (
        <>
          <span>{label.name}</span>
          <span className="text-muted-foreground">{label.detail}</span>
        </>
      )
    }
    case 'index':
      return (
        <>
          <span>{node.index.name}</span>
          <span className="text-muted-foreground">
            ({node.index.columns.join(', ')})
            {node.index.unique && !node.index.primary
              ? ` ${translate('database.explorer.unique', 'unique')}`
              : ''}
          </span>
        </>
      )
  }
}

/** The row's label at its full width, reported as the row's width whenever it changes. */
function MeasuredLabel({
  rowKey,
  onMeasure,
  children
}: {
  rowKey: string
  onMeasure: (key: string, width: number) => void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const label = ref.current
    if (!label) {
      return
    }
    // Why offsetLeft: it counts from the row's own box, indent included.
    const report = (): void =>
      onMeasure(rowKey, label.offsetLeft + label.offsetWidth + ROW_END_PADDING)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(label)
    return () => observer.disconnect()
  }, [rowKey, onMeasure])
  return (
    <span ref={ref} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      {children}
    </span>
  )
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

type TreeItemProps = {
  row: Extract<ExplorerRow, { type: 'node' | 'group' }>
  expandable: boolean
  selected: boolean
  /** Highlighted as where a dragged connection would land. */
  dropTarget: boolean
  onSelect: (key: string) => void
  onToggle: () => void
  onActivate: () => void
  onMeasure: (key: string, width: number) => void
  icon: React.ReactNode
  label: React.ReactNode
  menu: React.ReactNode
}

function TreeItem(props: TreeItemProps): React.JSX.Element {
  const { row, expandable, selected, onSelect, onMeasure } = props
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-level={row.depth + 1}
          aria-expanded={expandable ? row.expanded : undefined}
          aria-selected={selected}
          data-current={selected ? 'true' : undefined}
          // Why only connections: they are what moves between groups.
          draggable={row.type === 'node' && row.node.kind === 'connection'}
          onMouseDown={() => onSelect(row.key)}
          onDoubleClick={props.onActivate}
          className={cn(
            'flex h-full cursor-default items-center gap-1 text-xs hover:bg-accent',
            (selected || props.dropTarget) && 'bg-accent',
            props.dropTarget && 'ring-1 ring-inset ring-ring'
          )}
          style={{ paddingLeft: row.depth * INDENT_PX + 4, paddingRight: ROW_END_PADDING }}
        >
          {/* Why aria-hidden: the row's aria-expanded already says this, and it takes no focus. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={props.onToggle}
            className={cn(
              'flex size-4 shrink-0 items-center justify-center',
              !expandable && 'invisible'
            )}
          >
            <ChevronRight
              className={cn('size-3 transition-transform', row.expanded && 'rotate-90')}
            />
          </button>
          {props.icon}
          <MeasuredLabel rowKey={row.key} onMeasure={onMeasure}>
            {props.label}
          </MeasuredLabel>
        </div>
      </ContextMenuTrigger>
      {props.menu}
    </ContextMenu>
  )
}

export function DatabaseExplorerRow({
  row,
  selected,
  dropTarget,
  onSelect,
  onToggle,
  onToggleGroup,
  onActivate,
  onMeasure
}: {
  row: ExplorerRow
  selected: boolean
  dropTarget: boolean
  onSelect: (key: string) => void
  onToggle: (node: DatabaseExplorerNode) => void
  onToggleGroup: (group: string) => void
  /** Double-click: opens a table's data, expands anything else. */
  onActivate: (node: DatabaseExplorerNode) => void
  /** Reports the row's full width, so the tree can scroll sideways to it. */
  onMeasure: (key: string, width: number) => void
}): React.JSX.Element {
  if (row.type === 'status') {
    return <StatusRow row={row} />
  }
  const common = { selected, dropTarget, onSelect, onMeasure }
  if (row.type === 'group') {
    const Icon = row.expanded ? FolderOpen : Folder
    return (
      <TreeItem
        {...common}
        row={row}
        expandable
        onToggle={() => onToggleGroup(row.group)}
        onActivate={() => onToggleGroup(row.group)}
        icon={<Icon className={ICON_CLASS} />}
        label={
          <>
            <span>{row.group}</span>
            <span className="text-muted-foreground">{row.count}</span>
          </>
        }
        menu={<DatabaseExplorerGroupContextMenu group={row.group} />}
      />
    )
  }
  const { node } = row
  return (
    <TreeItem
      {...common}
      row={row}
      expandable={isExpandableNode(node)}
      onToggle={() => onToggle(node)}
      onActivate={() => onActivate(node)}
      icon={<NodeIcon node={node} />}
      label={<NodeLabel node={node} />}
      menu={<DatabaseExplorerContextMenu node={node} />}
    />
  )
}
