import { create } from 'zustand'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { DatabaseDdlTarget } from '../../../../shared/database/database-ddl-types'
import type { DatabasePropertiesTarget } from '../../../../shared/database/database-properties-types'
import { useDatabaseConsoleRunStore } from './console/database-console-run-store'
import { findDatabaseConnection, useDatabaseConnectionsStore } from './database-connections-store'
import {
  useDatabasePageStore,
  type DatabaseConsoleTab,
  type DatabaseTab,
  type DatabaseTableTab
} from './database-page-store'
import { tabSessionIds } from './database-page-tabs'
import { useDatabaseExplorerStore } from './explorer/database-explorer-store'

/** `group` files a new connection under that explorer group. */
type ConnectionEditorTarget =
  | { mode: 'new'; group?: string | null }
  | { mode: 'edit'; connectionId: string }

/** Naming a group: a new one for `connectionIds`, or a new name for an existing one. */
export type GroupNameRequest =
  | { mode: 'new'; connectionIds: string[] }
  | { mode: 'rename'; group: string }

type DatabaseDialogsState = {
  connectionEditor: ConnectionEditorTarget | null
  deletingConnectionId: string | null
  groupNameRequest: GroupNameRequest | null
  ddlRequest: { id: string; connectionId: string; target: DatabaseDdlTarget; title: string } | null
  propertiesRequest: {
    id: string
    connectionId: string
    target: DatabasePropertiesTarget
    title: string
  } | null
  openConnectionEditor: (target: ConnectionEditorTarget) => void
  closeConnectionEditor: () => void
  askToDeleteConnection: (connectionId: string) => void
  cancelDeleteConnection: () => void
  askForGroupName: (request: GroupNameRequest) => void
  closeGroupName: () => void
  showDdl: (connectionId: string, target: DatabaseDdlTarget, name: string) => void
  closeDdl: () => void
  showProperties: (connectionId: string, target: DatabasePropertiesTarget, name: string) => void
  closeProperties: () => void
}

export const useDatabaseDialogsStore = create<DatabaseDialogsState>((set) => ({
  connectionEditor: null,
  deletingConnectionId: null,
  groupNameRequest: null,
  ddlRequest: null,
  propertiesRequest: null,
  openConnectionEditor: (target) => set({ connectionEditor: target }),
  closeConnectionEditor: () => set({ connectionEditor: null }),
  askToDeleteConnection: (connectionId) => set({ deletingConnectionId: connectionId }),
  cancelDeleteConnection: () => set({ deletingConnectionId: null }),
  askForGroupName: (request) => set({ groupNameRequest: request }),
  closeGroupName: () => set({ groupNameRequest: null }),
  showDdl: (connectionId, target, name) =>
    set({
      ddlRequest: {
        id: createBrowserUuid(),
        connectionId,
        target,
        title: translate('database.ddl.title', 'DDL of {{value0}}', { value0: name })
      }
    }),
  closeDdl: () => set({ ddlRequest: null }),
  showProperties: (connectionId, target, name) =>
    set({
      propertiesRequest: {
        id: createBrowserUuid(),
        connectionId,
        target,
        title: translate('database.properties.title', 'Properties of {{value0}}', { value0: name })
      }
    }),
  closeProperties: () => set({ propertiesRequest: null })
}))

/** Opens a console; one opened from a schema (MySQL database) starts in it. */
export function openDatabaseConsole(
  connectionId: string,
  schema: string | null = null,
  database: string | null = null
): DatabaseConsoleTab {
  const name =
    findDatabaseConnection(connectionId)?.name ?? translate('database.console.title', 'Console')
  return useDatabasePageStore.getState().openConsole(connectionId, name, schema, database)
}

export function openDatabaseTable(
  connectionId: string,
  schema: string,
  relation: string,
  database: string | null = null
): DatabaseTableTab {
  return useDatabasePageStore.getState().openTable(connectionId, schema, relation, database)
}

function releaseTabs(tabs: readonly DatabaseTab[]): void {
  for (const tab of tabs) {
    useDatabaseConsoleRunStore.getState().dispose(tab.id)
    // Frees the tab's server sessions; console text stays on disk.
    for (const consoleId of tabSessionIds(tab)) {
      void window.api.database.closeConsole({ connectionId: tab.connectionId, consoleId })
    }
  }
}

export function closeDatabaseTab(tabId: string): void {
  const tab = useDatabasePageStore.getState().tabs.find((entry) => entry.id === tabId)
  if (!tab) {
    return
  }
  useDatabasePageStore.getState().closeTab(tabId)
  releaseTabs([tab])
}

export async function connectDatabase(connectionId: string, password?: string): Promise<boolean> {
  const connected = await useDatabaseConnectionsStore.getState().connect(connectionId, password)
  if (connected) {
    await useDatabaseExplorerStore.getState().showConnected(connectionId)
  }
  return connected
}

export async function disconnectDatabase(connectionId: string): Promise<void> {
  await useDatabaseConnectionsStore.getState().disconnect(connectionId)
  useDatabaseExplorerStore.getState().resetConnection(connectionId)
}

/** The reason the connection was kept, or null once it is deleted. */
export async function deleteDatabaseConnection(connectionId: string): Promise<string | null> {
  const closed = useDatabasePageStore.getState().closeTabsForConnection(connectionId)
  closed.forEach((tab) => useDatabaseConsoleRunStore.getState().dispose(tab.id))
  const deleted = await window.api.database.deleteConnection(connectionId)
  useDatabaseExplorerStore.getState().resetConnection(connectionId)
  await useDatabaseConnectionsStore.getState().refresh()
  return deleted.ok ? null : deleted.error.message
}
