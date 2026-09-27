import { useEffect } from 'react'
import { useDatabaseConnectionsStore } from './database-connections-store'
import { useDatabaseExplorerStore } from './explorer/database-explorer-store'
import { invalidateSqlCatalog } from './console/sql-completion-catalog'
import { useDatabaseJobsStore } from './jobs/database-jobs-store'

let subscribed = false

// Why never unsubscribed: sessions keep running (and can drop) while the page is closed,
// and the stores outlive the page, so they must keep tracking main's state.
function subscribeToSessionEvents(): void {
  if (subscribed) {
    return
  }
  subscribed = true
  window.api.database.onEvent((event) => {
    if (event.kind === 'job-progress') {
      useDatabaseJobsStore.getState().applyProgress(event)
      return
    }
    useDatabaseConnectionsStore.getState().applySessionEvent(event)
    if (event.state === 'disconnected' || event.state === 'error') {
      // A dead session's tree is stale; expanding again reconnects and reloads it.
      useDatabaseExplorerStore.getState().resetConnection(event.connectionId)
      invalidateSqlCatalog(event.connectionId)
    }
  })
}

/** Loads connections and starts mirroring main's session state. */
export function useDatabaseSessionEvents(): void {
  useEffect(() => {
    subscribeToSessionEvents()
    void useDatabaseConnectionsStore.getState().refresh()
  }, [])
}
