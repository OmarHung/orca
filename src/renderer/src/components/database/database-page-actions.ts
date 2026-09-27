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
import { getTableEditState, useDatabaseTableEditsStore } from './table/database-table-edits-store'
import { tableEditCount } from './table/table-edits'

type ConnectionEditorTarget = { mode: 'new' } | { mode: 'edit'; connectionId: string }

type DatabaseDialogsState = {
  connectionEditor: ConnectionEditorTarget | null
  deletingConnectionId: string | null
  /** An action on a table tab that waits for the user to discard its pending edits. */
  pendingDiscard: { tabId: string; proceed: () => void } | null
  /** A console whose close waits for the user to commit or roll back its transaction. */
  closingWithTransaction: string | null
  ddlRequest: { id: string; connectionId: string; target: DatabaseDdlTarget; title: string } | null
  openConnectionEditor: (target: ConnectionEditorTarget) => void
  closeConnectionEditor: () => void
  askToDeleteConnection: (connectionId: string) => void
  cancelDeleteConnection: () => void
  askToDiscard: (tabId: string, proceed: () => void) => void
  cancelDiscard: () => void
  askToEndTransaction: (tabId: string) => void
  cancelEndTransaction: () => void
  showDdl: (connectionId: string, target: DatabaseDdlTarget, name: string) => void
  closeDdl: () => void
}

export const useDatabaseDialogsStore = create<DatabaseDialogsState>((set) => ({
  connectionEditor: null,
  deletingConnectionId: null,
  pendingDiscard: null,
  closingWithTransaction: null,
  ddlRequest: null,
  openConnectionEditor: (target) => set({ connectionEditor: target }),
  closeConnectionEditor: () => set({ connectionEditor: null }),
  askToDeleteConnection: (connectionId) => set({ deletingConnectionId: connectionId }),
  cancelDeleteConnection: () => set({ deletingConnectionId: null }),
  askToDiscard: (tabId, proceed) => set({ pendingDiscard: { tabId, proceed } }),
  cancelDiscard: () => set({ pendingDiscard: null }),
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

export function openDatabaseConsole(connectionId: string): DatabaseConsoleTab {
  const name =
    findDatabaseConnection(connectionId)?.name ?? translate('database.console.title', 'Console')
  return useDatabasePageStore.getState().openConsole(connectionId, name)
}

export function openDatabaseTable(
  connectionId: string,
  schema: string,
  relation: string
): DatabaseTableTab {
  return useDatabasePageStore.getState().openTable(connectionId, schema, relation)
}

function releaseTabs(tabs: readonly DatabaseTab[]): void {
  for (const tab of tabs) {
    useDatabaseConsoleRunStore.getState().dispose(tab.id)
    useDatabaseTableEditsStore.getState().dispose(tab.id)
    // Frees the tab's server sessions; console text stays on disk.
    for (const consoleId of tabSessionIds(tab)) {
      void window.api.database.closeConsole({ connectionId: tab.connectionId, consoleId })
    }
  }
}

/**
 * Closes a tab. Unless `discard` is set, a table tab with pending edits or a console with an
 * open transaction asks first.
 */
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
  const { edits } = getTableEditState(useDatabaseTableEditsStore.getState().tabs, tabId)
  if (!options.discard && tableEditCount(edits) > 0) {
    useDatabaseDialogsStore
      .getState()
      .askToDiscard(tabId, () => closeDatabaseTab(tabId, { discard: true }))
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
  closed.forEach((tab) => {
    useDatabaseConsoleRunStore.getState().dispose(tab.id)
    useDatabaseTableEditsStore.getState().dispose(tab.id)
  })
  await window.api.database.deleteConnection(connectionId)
  useDatabaseExplorerStore.getState().resetConnection(connectionId)
  await useDatabaseConnectionsStore.getState().refresh()
}
