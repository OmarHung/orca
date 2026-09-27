import React from 'react'
import {
  Copy,
  FileCode2,
  Pencil,
  Plug,
  RefreshCw,
  SquareTerminal,
  Table2,
  Trash2,
  Unplug
} from 'lucide-react'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import { findDatabaseConnection, useDatabaseConnectionsStore } from '../database-connections-store'
import {
  connectDatabase,
  disconnectDatabase,
  openDatabaseConsole,
  openDatabaseTable,
  useDatabaseDialogsStore
} from '../database-page-actions'
import { useDatabaseExplorerStore } from './database-explorer-store'
import { qualifiedRelationName } from '../../../../../shared/database/sql-identifiers'
import { isExpandableNode, type DatabaseExplorerNode } from './database-explorer-tree'

function copy(text: string): void {
  void window.api.ui.writeClipboardText(text)
}

function ConnectionItems({ connectionId }: { connectionId: string }): React.JSX.Element {
  const connected = useDatabaseConnectionsStore(
    (state) => state.sessions[connectionId]?.state === 'connected'
  )
  const dialogs = useDatabaseDialogsStore.getState()
  return (
    <>
      <ContextMenuItem onSelect={() => openDatabaseConsole(connectionId)}>
        <SquareTerminal />
        {translate('database.explorer.newConsole', 'New Console')}
      </ContextMenuItem>
      {connected ? (
        <ContextMenuItem onSelect={() => void disconnectDatabase(connectionId)}>
          <Unplug />
          {translate('database.explorer.disconnect', 'Disconnect')}
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onSelect={() => void connectDatabase(connectionId)}>
          <Plug />
          {translate('database.explorer.connect', 'Connect')}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => dialogs.openConnectionEditor({ mode: 'edit', connectionId })}
      >
        <Pencil />
        {translate('database.explorer.editConnection', 'Edit Connection…')}
      </ContextMenuItem>
      <ContextMenuItem
        variant="destructive"
        onSelect={() => dialogs.askToDeleteConnection(connectionId)}
      >
        <Trash2 />
        {translate('database.explorer.deleteConnection', 'Delete Connection…')}
      </ContextMenuItem>
    </>
  )
}

function copyText(node: DatabaseExplorerNode): string | null {
  switch (node.kind) {
    case 'connection':
      return null
    case 'schema':
      return node.schema
    case 'relation':
      return qualifiedRelationName(
        node.schema,
        node.relation.name,
        findDatabaseConnection(node.connectionId)?.driver
      )
    case 'column':
      return node.column.name
    case 'routine':
      return node.routine.name
    case 'constraint':
      return node.constraint.name || null
    case 'index':
      return node.index.name
    case 'folder':
      return null
  }
}

function showDdl(node: Extract<DatabaseExplorerNode, { kind: 'relation' | 'routine' }>): void {
  const dialogs = useDatabaseDialogsStore.getState()
  if (node.kind === 'relation') {
    dialogs.showDdl(
      node.connectionId,
      { kind: 'relation', schema: node.schema, relation: node.relation.name },
      node.relation.name
    )
    return
  }
  dialogs.showDdl(
    node.connectionId,
    {
      kind: 'routine',
      schema: node.schema,
      identity: node.routine.identity,
      routineKind: node.routine.kind
    },
    node.routine.name
  )
}

export function DatabaseExplorerContextMenu({
  node
}: {
  node: DatabaseExplorerNode
}): React.JSX.Element {
  const text = copyText(node)
  const canRefresh = isExpandableNode(node) && node.kind !== 'connection'
  return (
    <ContextMenuContent>
      {node.kind === 'connection' ? <ConnectionItems connectionId={node.connectionId} /> : null}
      {node.kind === 'schema' ? (
        <ContextMenuItem onSelect={() => openDatabaseConsole(node.connectionId)}>
          <SquareTerminal />
          {translate('database.explorer.newConsole', 'New Console')}
        </ContextMenuItem>
      ) : null}
      {node.kind === 'relation' ? (
        <ContextMenuItem
          onSelect={() => openDatabaseTable(node.connectionId, node.schema, node.relation.name)}
        >
          <Table2 />
          {translate('database.explorer.openData', 'Open Data')}
        </ContextMenuItem>
      ) : null}
      {node.kind === 'relation' || node.kind === 'routine' ? (
        <ContextMenuItem onSelect={() => showDdl(node)}>
          <FileCode2 />
          {translate('database.explorer.showDdl', 'Show DDL')}
        </ContextMenuItem>
      ) : null}
      {text !== null ? (
        <ContextMenuItem onSelect={() => copy(text)}>
          <Copy />
          {node.kind === 'relation'
            ? translate('database.explorer.copyQualifiedName', 'Copy Qualified Name')
            : translate('database.explorer.copyName', 'Copy Name')}
        </ContextMenuItem>
      ) : null}
      {canRefresh ? (
        <ContextMenuItem onSelect={() => void useDatabaseExplorerStore.getState().refresh(node)}>
          <RefreshCw />
          {translate('database.explorer.refresh', 'Refresh')}
        </ContextMenuItem>
      ) : null}
    </ContextMenuContent>
  )
}
