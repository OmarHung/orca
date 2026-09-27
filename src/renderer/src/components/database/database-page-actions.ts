import { create } from 'zustand'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { DatabaseDdlTarget } from '../../../../shared/database/database-ddl-types'
import {
  getConsoleRunState,
  useDatabaseConsoleRunStore
} from './console/database-console-run-store'
import { findDatabaseConnection, useDatabaseConnectionsStore } from './database-connections-store'
import {
  useDatabasePageStore,
  type DatabaseConsoleTab,
  type DatabaseTab,
  type DatabaseTableTab
} from './database-page-store'
import { tabSessionIds } from './database-page-tabs'
import { useDatabaseExplorerStore } from './explorer/database-explorer-store'

type ConnectionEditorTarget = { mode: 'new' } | { mode: 'edit'; connectionId: string }

type DatabaseDialogsState = {
  connectionEditor: ConnectionEditorTarget | null
  deletingConnectionId: string | null
  /** A console whose close waits for the user to commit or roll back its transaction. */
  closingWithTransaction: string | null
  ddlRequest: { id: string; connectionId: string; target: DatabaseDdlTarget; title: string } | null
  openConnectionEditor: (target: ConnectionEditorTarget) => void
  closeConnectionEditor: () => void
  askToDeleteConnection: (connectionId: string) => void
  cancelDeleteConnection: () => void
  askToEndTransaction: (tabId: string) => void
  cancelEndTransaction: () => void
  showDdl: (connectionId: string, target: DatabaseDdlTarget, name: string) => void
  closeDdl: () => void
}

export const useDatabaseDialogsStore = create<DatabaseDialogsState>((set) => ({
  connectionEditor: null,
  deletingConnectionId: null,
  closingWithTransaction: null,
  ddlRequest: null,
  openConnectionEditor: (target) => set({ connectionEditor: target }),
  closeConnectionEditor: () => set({ connectionEditor: null }),
  askToDeleteConnection: (connectionId) => set({ deletingConnectionId: connectionId }),
  cancelDeleteConnection: () => set({ deletingConnectionId: null }),
  askToEndTransaction: (tabId) => set({ closingWithTransaction: tabId }),
  cancelEndTransaction: () => set({ closingWithTransaction: null }),
  showDdl: (connectionId, target, name) =>
    set({
      ddlRequest: {
        id: createBrowserUuid(),
        connectionId,
        target,
        title: translate('database.ddl.title', 'DDL of {{value0}}', { value0: name })
      }
    }),
  closeDdl: () => set({ ddlRequest: null })
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

/** Closes a tab. Unless `discard` is set, a console with an open transaction asks first. */
export function closeDatabaseTab(tabId: string, options: { discard?: boolean } = {}): void {
  const tab = useDatabasePageStore.getState().tabs.find((entry) => entry.id === tabId)
  if (!tab) {
    return
  }
  const { transaction } = getConsoleRunState(useDatabaseConsoleRunStore.getState().consoles, tabId)
  if (!options.discard && tab.kind === 'console' && transaction !== 'none') {
    useDatabaseDialogsStore.getState().askToEndTransaction(tabId)
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

export async function deleteDatabaseConnection(connectionId: string): Promise<void> {
  const closed = useDatabasePageStore.getState().closeTabsForConnection(connectionId)
  closed.forEach((tab) => useDatabaseConsoleRunStore.getState().dispose(tab.id))
  await window.api.database.deleteConnection(connectionId)
  useDatabaseExplorerStore.getState().resetConnection(connectionId)
  await useDatabaseConnectionsStore.getState().refresh()
}
