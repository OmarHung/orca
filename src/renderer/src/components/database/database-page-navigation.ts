import { useAppStore } from '@/store'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'

// Why module state, not the app store: keeps the fork's page out of upstream's UI slice.
let viewBeforeDatabase: Exclude<TopLevelView, 'database'> = 'terminal'

export function openDatabasePage(): void {
  const { activeView, setActiveView } = useAppStore.getState()
  if (activeView === 'database') {
    return
  }
  viewBeforeDatabase = activeView
  setActiveView('database')
}

export function closeDatabasePage(): void {
  const { activeView, setActiveView } = useAppStore.getState()
  if (activeView === 'database') {
    setActiveView(viewBeforeDatabase)
  }
}

export function toggleDatabasePage(): void {
  if (useAppStore.getState().activeView === 'database') {
    closeDatabasePage()
  } else {
    openDatabasePage()
  }
}
