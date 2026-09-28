import React from 'react'
import { Folder, FolderInput, FolderMinus, FolderPlus, Pencil, Plus, Ungroup } from 'lucide-react'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import {
  moveDatabaseConnectionsToGroup,
  ungroupDatabaseConnections
} from '../database-connection-group-actions'
import { databaseConnectionGroupNames } from '../database-connection-groups'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import { useDatabaseDialogsStore } from '../database-page-actions'

/** A connection's "Move to Group" submenu: the other groups, a new one, or back to the top. */
export function MoveToGroupSubmenu({ connectionId }: { connectionId: string }): React.JSX.Element {
  const connections = useDatabaseConnectionsStore((state) => state.connections)
  const current = connections.find((connection) => connection.id === connectionId)?.group ?? null
  const others = databaseConnectionGroupNames(connections).filter((group) => group !== current)
  const move = (group: string | null): void =>
    void moveDatabaseConnectionsToGroup([connectionId], group)
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderInput />
        {translate('database.groups.moveTo', 'Move to Group')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {others.map((group) => (
          <ContextMenuItem key={group} onSelect={() => move(group)}>
            <Folder />
            {group}
          </ContextMenuItem>
        ))}
        {others.length > 0 ? <ContextMenuSeparator /> : null}
        <ContextMenuItem
          onSelect={() =>
            useDatabaseDialogsStore
              .getState()
              .askForGroupName({ mode: 'new', connectionIds: [connectionId] })
          }
        >
          <FolderPlus />
          {translate('database.groups.newGroup', 'New Group…')}
        </ContextMenuItem>
        {current !== null ? (
          <ContextMenuItem onSelect={() => move(null)}>
            <FolderMinus />
            {translate('database.groups.removeFromGroup', 'Remove from Group')}
          </ContextMenuItem>
        ) : null}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

export function DatabaseExplorerGroupContextMenu({ group }: { group: string }): React.JSX.Element {
  const dialogs = useDatabaseDialogsStore.getState()
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => dialogs.openConnectionEditor({ mode: 'new', group })}>
        <Plus />
        {translate('database.explorer.newConnection', 'New Connection…')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => dialogs.askForGroupName({ mode: 'rename', group })}>
        <Pencil />
        {translate('database.groups.renameGroup', 'Rename Group…')}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void ungroupDatabaseConnections(group)}>
        <Ungroup />
        {translate('database.groups.ungroup', 'Ungroup')}
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
