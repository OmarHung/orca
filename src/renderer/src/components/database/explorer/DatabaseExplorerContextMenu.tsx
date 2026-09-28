import React from 'react'
import {
  Copy,
  FileDown,
  FileCode2,
  Info,
  Pencil,
  Plug,
  RefreshCw,
  SquareTerminal,
  Sheet,
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
import { MoveToGroupSubmenu } from './DatabaseExplorerGroupMenus'
import { useDatabaseJobsStore, type DatabaseDumpScope } from '../jobs/database-jobs-store'
import type { DatabasePropertiesTarget } from '../../../../../shared/database/database-properties-types'
import { qualifiedRelationName } from '../../../../../shared/database/sql-identifiers'
import { isExpandableNode, type DatabaseExplorerNode } from './database-explorer-tree'

function copy(text: string): void {
  void window.api.ui.writeClipboardText(text)
}

type PropertiesNode = Extract<
  DatabaseExplorerNode,
  { kind: 'connection' | 'database' | 'schema' | 'relation' }
>

function hasProperties(node: DatabaseExplorerNode): node is PropertiesNode {
  return (
    node.kind === 'connection' ||
    node.kind === 'database' ||
    node.kind === 'schema' ||
    node.kind === 'relation'
  )
}

/** What Properties reads for `node`, and the name its dialog shows. */
function propertiesOf(node: PropertiesNode): { target: DatabasePropertiesTarget; name: string } {
  const database = 'database' in node && node.database !== null ? { database: node.database } : {}
  switch (node.kind) {
    case 'connection':
      return {
        target: { kind: 'server' },
        name: findDatabaseConnection(node.connectionId)?.name ?? ''
      }
    case 'database':
      return { target: { kind: 'database', database: node.database }, name: node.database }
    case 'schema':
      return { target: { kind: 'schema', ...database, schema: node.schema }, name: node.schema }
    case 'relation':
      return {
        target: {
          kind: 'relation',
          ...database,
          schema: node.schema,
          relation: node.relation.name
        },
        name: node.relation.name
      }
  }
}

function PropertiesItem({ node }: { node: PropertiesNode }): React.JSX.Element {
  const open = (): void => {
    const { target, name } = propertiesOf(node)
    useDatabaseDialogsStore.getState().showProperties(node.connectionId, target, name)
  }
  return (
    <ContextMenuItem onSelect={open}>
      <Info />
      {translate('database.explorer.properties', 'Properties…')}
    </ContextMenuItem>
  )
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
        <>
          <ContextMenuItem onSelect={() => void disconnectDatabase(connectionId)}>
            <Unplug />
            {translate('database.explorer.disconnect', 'Disconnect')}
          </ContextMenuItem>
          <PropertiesItem node={{ kind: 'connection', key: connectionId, connectionId }} />
        </>
      ) : (
        <ContextMenuItem onSelect={() => void connectDatabase(connectionId)}>
          <Plug />
          {translate('database.explorer.connect', 'Connect')}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <MoveToGroupSubmenu connectionId={connectionId} />
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
    case 'database':
      return node.database
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

type DumpableNode = Extract<
  DatabaseExplorerNode,
  { kind: 'connection' | 'database' | 'schema' | 'relation' }
>

function isDumpable(node: DatabaseExplorerNode): node is DumpableNode {
  switch (node.kind) {
    case 'connection':
    case 'database':
    case 'schema':
      return true
    case 'relation':
      return node.relation.kind !== 'foreign-table'
    case 'column':
    case 'folder':
    case 'routine':
    case 'constraint':
    case 'index':
      return false
  }
}

/** What a dump opened on `node` covers, e.g. `prod › shop › sales › people`. */
function dumpScope(node: DumpableNode, dataOnly: boolean): DatabaseDumpScope {
  const connectionName = findDatabaseConnection(node.connectionId)?.name ?? ''
  const database = node.kind === 'connection' ? null : node.database
  const schema = node.kind === 'schema' || node.kind === 'relation' ? node.schema : null
  const only = node.kind === 'relation' ? { schema: node.schema, name: node.relation.name } : null
  const label = [connectionName, database, schema, only?.name]
    .filter((part): part is string => Boolean(part))
    .join(' › ')
  return { connectionId: node.connectionId, database, schema, only, dataOnly, label }
}

function DumpItems({ node }: { node: DumpableNode }): React.JSX.Element {
  const jobs = useDatabaseJobsStore.getState()
  const isView =
    node.kind === 'relation' &&
    (node.relation.kind === 'view' || node.relation.kind === 'materialized-view')
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => jobs.openDump(dumpScope(node, false))}>
        <FileDown />
        {translate('database.explorer.dumpToSql', 'Dump to SQL…')}
      </ContextMenuItem>
      {isView ? null : (
        <ContextMenuItem onSelect={() => jobs.openDump(dumpScope(node, true))}>
          <Sheet />
          {translate('database.explorer.exportData', 'Export Data…')}
        </ContextMenuItem>
      )}
    </>
  )
}

function showDdl(node: Extract<DatabaseExplorerNode, { kind: 'relation' | 'routine' }>): void {
  const dialogs = useDatabaseDialogsStore.getState()
  if (node.kind === 'relation') {
    dialogs.showDdl(
      node.connectionId,
      {
        kind: 'relation',
        ...(node.database === null ? {} : { database: node.database }),
        schema: node.schema,
        relation: node.relation.name
      },
      node.relation.name
    )
    return
  }
  dialogs.showDdl(
    node.connectionId,
    {
      kind: 'routine',
      ...(node.database === null ? {} : { database: node.database }),
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
      {node.kind === 'database' ? (
        <ContextMenuItem
          onSelect={() => openDatabaseConsole(node.connectionId, null, node.database)}
        >
          <SquareTerminal />
          {translate('database.explorer.newConsole', 'New Console')}
        </ContextMenuItem>
      ) : null}
      {node.kind === 'schema' ? (
        <ContextMenuItem
          onSelect={() => openDatabaseConsole(node.connectionId, node.schema, node.database)}
        >
          <SquareTerminal />
          {translate('database.explorer.newConsole', 'New Console')}
        </ContextMenuItem>
      ) : null}
      {node.kind === 'relation' ? (
        <ContextMenuItem
          onSelect={() =>
            openDatabaseTable(node.connectionId, node.schema, node.relation.name, node.database)
          }
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
      {hasProperties(node) && node.kind !== 'connection' ? <PropertiesItem node={node} /> : null}
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
      {isDumpable(node) ? <DumpItems node={node} /> : null}
    </ContextMenuContent>
  )
}
