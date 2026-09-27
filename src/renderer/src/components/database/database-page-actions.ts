import { create } from 'zustand'
import { translate } from '@/i18n/i18n'
import { useDatabaseConsoleRunStore } from './console/database-console-run-store'
import { findDatabaseConnection, useDatabaseConnectionsStore } from './database-connections-store'
import { useDatabasePageStore, type DatabaseConsoleTab } from './database-page-store'
import { useDatabaseExplorerStore } from './explorer/database-explorer-store'

type ConnectionEditorTarget = { mode: 'new' } | { mode: 'edit'; connectionId: string }

type DatabaseDialogsState = {
  connectionEditor: ConnectionEditorTarget | null
  deletingConnectionId: string | null
  openConnectionEditor: (target: ConnectionEditorTarget) => void
  closeConnectionEditor: () => void
  askToDeleteConnection: (connectionId: string) => void
  cancelDeleteConnection: () => void
}

export const useDatabaseDialogsStore = create<DatabaseDialogsState>((set) => ({
  connectionEditor: null,
  deletingConnectionId: null,
  openConnectionEditor: (target) => set({ connectionEditor: target }),
  closeConnectionEditor: () => set({ connectionEditor: null }),
  askToDeleteConnection: (connectionId) => set({ deletingConnectionId: connectionId }),
  cancelDeleteConnection: () => set({ deletingConnectionId: null })
}))

export function openDatabaseConsole(connectionId: string): DatabaseConsoleTab {
  const name =
    findDatabaseConnection(connectionId)?.name ?? translate('database.console.title', 'Console')
  return useDatabasePageStore.getState().openConsole(connectionId, name)
}

function releaseConsoles(tabs: readonly DatabaseConsoleTab[]): void {
  for (const tab of tabs) {
    useDatabaseConsoleRunStore.getState().dispose(tab.id)
    // Frees the console's server session; its text stays on disk.
    void window.api.database.closeConsole({
      connectionId: tab.connectionId,
      consoleId: tab.consoleId
    })
  }
}

export function closeDatabaseConsoleTab(tabId: string): void {
  const tab = useDatabasePageStore.getState().tabs.find((entry) => entry.id === tabId)
  if (!tab) {
    return
  }
  useDatabasePageStore.getState().closeTab(tabId)
  releaseConsoles([tab])
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

export async function deleteDatabaseConnection(connectionId: string): Promise<void> {
  const closed = useDatabasePageStore.getState().closeTabsForConnection(connectionId)
  closed.forEach((tab) => useDatabaseConsoleRunStore.getState().dispose(tab.id))
  await window.api.database.deleteConnection(connectionId)
  useDatabaseExplorerStore.getState().resetConnection(connectionId)
  await useDatabaseConnectionsStore.getState().refresh()
}
