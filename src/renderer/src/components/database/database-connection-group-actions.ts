import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { asDatabaseResult, useDatabaseConnectionsStore } from './database-connections-store'
import { useDatabasePageStore } from './database-page-store'

async function setConnectionsGroup(
  connectionIds: string[],
  group: string | null
): Promise<boolean> {
  if (connectionIds.length === 0) {
    return true
  }
  let failure: string | null
  try {
    const result = asDatabaseResult(
      await window.api.database.setConnectionGroup({ connectionIds, group })
    )
    failure = result.ok ? null : result.error.message
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  if (failure !== null) {
    toast.error(translate('database.groups.saveFailed', 'Couldn’t change the connection’s group'), {
      description: failure
    })
    return false
  }
  await useDatabaseConnectionsStore.getState().refresh()
  return true
}

function connectionsInGroup(group: string): string[] {
  return useDatabaseConnectionsStore
    .getState()
    .connections.filter((connection) => connection.group === group)
    .map((connection) => connection.id)
}

/** Files connections under `group` (null: the top level), unfolding it so they stay in sight. */
export async function moveDatabaseConnectionsToGroup(
  connectionIds: string[],
  group: string | null
): Promise<void> {
  const moved = await setConnectionsGroup(connectionIds, group)
  if (moved && group !== null) {
    useDatabasePageStore.getState().setConnectionGroupCollapsed(group, false)
  }
}

/** Renaming onto an existing group merges the two. */
export async function renameDatabaseConnectionGroup(from: string, to: string): Promise<void> {
  if (from === to) {
    return
  }
  const page = useDatabasePageStore.getState()
  const collapsed = page.collapsedConnectionGroups.includes(from)
  if (await setConnectionsGroup(connectionsInGroup(from), to)) {
    page.setConnectionGroupCollapsed(from, false)
    page.setConnectionGroupCollapsed(to, collapsed)
  }
}

/** Moves a group's connections to the top level; the connections themselves stay. */
export async function ungroupDatabaseConnections(group: string): Promise<void> {
  if (await setConnectionsGroup(connectionsInGroup(group), null)) {
    useDatabasePageStore.getState().setConnectionGroupCollapsed(group, false)
  }
}
