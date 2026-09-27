import React, { useRef } from 'react'
import { ArrowLeft, Database, Plus, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { ResizeHandle } from '../bottom-panel/ResizeHandle'
import { useDragResize } from '../bottom-panel/use-drag-resize'
import { DatabaseConsoleView } from './console/DatabaseConsoleView'
import { DatabaseConnectionDialog } from './connection-dialog/DatabaseConnectionDialog'
import { DatabaseDeleteConnectionDialog } from './DatabaseDeleteConnectionDialog'
import { DatabasePasswordDialog } from './DatabasePasswordDialog'
import { DatabaseTabStrip } from './DatabaseTabStrip'
import { useDatabaseConnectionsStore } from './database-connections-store'
import { closeDatabasePage } from './database-page-navigation'
import { openDatabaseConsole, useDatabaseDialogsStore } from './database-page-actions'
import { DATABASE_EXPLORER_WIDTH, useDatabasePageStore } from './database-page-store'
import { DatabaseExplorerPanel } from './explorer/DatabaseExplorerPanel'
import { DatabaseDiscardEditsDialog } from './table/DatabaseDiscardEditsDialog'
import { DatabaseOpenTransactionDialog } from './console/DatabaseOpenTransactionDialog'
import { DatabaseDdlDialog } from './explorer/DatabaseDdlDialog'
import { DatabaseTableView } from './table/DatabaseTableView'
import { useDatabaseSessionEvents } from './use-database-session-events'

const MIN_MAIN_WIDTH = 320

function PageHeader(): React.JSX.Element {
  const openEditor = useDatabaseDialogsStore((state) => state.openConnectionEditor)
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
      <Button variant="outline" size="sm" onClick={closeDatabasePage}>
        <ArrowLeft className="size-3.5" />
        {translate('database.page.back', 'Back')}
      </Button>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
        <Database className="size-4 text-muted-foreground" />
      </div>
      <h1 className="truncate text-base font-semibold text-foreground">
        {translate('database.page.title', 'Database')}
      </h1>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={() => openEditor({ mode: 'new' })}
      >
        <Plus className="size-3.5" />
        {translate('database.page.newConnection', 'New Connection')}
      </Button>
    </div>
  )
}

function EmptyMain(): React.JSX.Element {
  const connections = useDatabaseConnectionsStore((state) => state.connections)
  const loaded = useDatabaseConnectionsStore((state) => state.loaded)
  const openEditor = useDatabaseDialogsStore((state) => state.openConnectionEditor)
  if (!loaded) {
    return <div className="flex-1" />
  }
  const first = connections[0]
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <Database className="size-7 text-muted-foreground" />
      <p className="max-w-sm text-sm text-muted-foreground">
        {first
          ? translate(
              'database.page.emptyWithConnections',
              'Open a console to run SQL. Right-click a connection for more actions.'
            )
          : translate(
              'database.page.emptyNoConnections',
              'Add a database connection to browse its schema and run SQL.'
            )}
      </p>
      {first ? (
        <Button onClick={() => openDatabaseConsole(first.id)}>
          <SquareTerminal className="size-4" />
          {translate('database.page.openConsole', 'Open Console for {{value0}}', {
            value0: first.name
          })}
        </Button>
      ) : (
        <Button onClick={() => openEditor({ mode: 'new' })}>
          <Plus className="size-4" />
          {translate('database.page.newConnection', 'New Connection')}
        </Button>
      )}
    </div>
  )
}

function ConnectionEditorHost(): React.JSX.Element | null {
  const target = useDatabaseDialogsStore((state) => state.connectionEditor)
  const close = useDatabaseDialogsStore((state) => state.closeConnectionEditor)
  const existing = useDatabaseConnectionsStore((state) =>
    target?.mode === 'edit'
      ? (state.connections.find((entry) => entry.id === target.connectionId) ?? null)
      : null
  )
  if (!target) {
    return null
  }
  return (
    <DatabaseConnectionDialog
      key={target.mode === 'edit' ? target.connectionId : 'new'}
      existing={existing}
      onClose={close}
    />
  )
}

function DatabaseWorkbench(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const tabs = useDatabasePageStore((state) => state.tabs)
  const activeTabId = useDatabasePageStore((state) => state.activeTabId)
  const explorerWidth = useDatabasePageStore((state) => state.explorerWidth)
  const setExplorerWidth = useDatabasePageStore((state) => state.setExplorerWidth)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const { size, handleProps } = useDragResize({
    axis: 'x',
    size: explorerWidth,
    setSize: setExplorerWidth,
    min: DATABASE_EXPLORER_WIDTH.min,
    getMax: () => (containerRef.current?.clientWidth ?? explorerWidth) - MIN_MAIN_WIDTH,
    direction: 1
  })

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      <div className="relative shrink-0 border-r border-border" style={{ width: size }}>
        <DatabaseExplorerPanel />
        <ResizeHandle
          edge="right"
          label={translate('database.page.resizeExplorer', 'Resize database explorer')}
          handleProps={handleProps}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {activeTab ? (
          <>
            <DatabaseTabStrip />
            <div className="min-h-0 flex-1">
              {activeTab.kind === 'table' ? (
                <DatabaseTableView key={activeTab.id} tab={activeTab} />
              ) : (
                <DatabaseConsoleView key={activeTab.id} tab={activeTab} />
              )}
            </div>
          </>
        ) : (
          <EmptyMain />
        )}
      </div>
    </div>
  )
}

export default function DatabasePage(): React.JSX.Element {
  useDatabaseSessionEvents()
  const isWebClient = isWebClientLocation()
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader />
      {isWebClient ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {translate(
            'database.page.desktopOnly',
            'Databases are available in the desktop app only.'
          )}
        </div>
      ) : (
        <DatabaseWorkbench />
      )}
      <ConnectionEditorHost />
      <DatabasePasswordDialog />
      <DatabaseDeleteConnectionDialog />
      <DatabaseDiscardEditsDialog />
      <DatabaseOpenTransactionDialog />
      <DatabaseDdlDialog />
    </div>
  )
}
