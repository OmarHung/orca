import React, { useCallback, useRef } from 'react'
import type { editor } from 'monaco-editor'
import { Loader2, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { translate } from '@/i18n/i18n'
import { ResizeHandle } from '../../bottom-panel/ResizeHandle'
import { useDragResize } from '../../bottom-panel/use-drag-resize'
import type { SqlStatementRange } from '../../../../../shared/database/sql-statement-splitter'
import { DatabaseConnectionBadge } from '../DatabaseConnectionBadge'
import {
  DATABASE_RESULTS_HEIGHT,
  useDatabasePageStore,
  type DatabaseConsoleTab
} from '../database-page-store'
import { DatabaseConsoleEditor, runDatabaseConsoleFromToolbar } from './DatabaseConsoleEditor'
import { DatabaseResultsPane } from './DatabaseResultsPane'
import { getConsoleRunState, useDatabaseConsoleRunStore } from './database-console-run-store'
import { useDatabaseConsoleText } from './use-database-console-text'
import { sqlDialectForDriver } from './database-console-statements'
import { useDatabaseConnectionsStore } from '../database-connections-store'

const MIN_EDITOR_HEIGHT = 80

function runShortcutKeys(): string[] {
  return navigator.userAgent.includes('Mac') ? ['⌘', '↩'] : ['Ctrl', 'Enter']
}

export function DatabaseConsoleView({ tab }: { tab: DatabaseConsoleTab }): React.JSX.Element {
  const { text, update } = useDatabaseConsoleText(tab)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<editor.ICodeEditor | null>(null)
  const running = useDatabaseConsoleRunStore(
    (state) => getConsoleRunState(state.consoles, tab.id).running
  )
  const errorOffset = useDatabaseConsoleRunStore(
    (state) => getConsoleRunState(state.consoles, tab.id).errorOffset
  )
  const run = useDatabaseConsoleRunStore((state) => state.run)
  const cancel = useDatabaseConsoleRunStore((state) => state.cancel)
  const driver = useDatabaseConnectionsStore(
    (state) => state.connections.find((entry) => entry.id === tab.connectionId)?.driver
  )
  const dialect = sqlDialectForDriver(driver ?? 'postgres')
  const resultsHeight = useDatabasePageStore((state) => state.resultsHeight)
  const setResultsHeight = useDatabasePageStore((state) => state.setResultsHeight)

  const { size, handleProps } = useDragResize({
    axis: 'y',
    size: resultsHeight,
    setSize: setResultsHeight,
    min: DATABASE_RESULTS_HEIGHT.min,
    getMax: () => (containerRef.current?.clientHeight ?? resultsHeight) - MIN_EDITOR_HEIGHT,
    direction: -1
  })

  const handleRun = useCallback(
    (statements: SqlStatementRange[]) => void run(tab, statements),
    [run, tab]
  )
  const handleEditorReady = useCallback((instance: editor.ICodeEditor | null) => {
    editorRef.current = instance
  }, [])

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={running || text === null}
              aria-label={translate('database.console.run', 'Run')}
              onClick={() =>
                runDatabaseConsoleFromToolbar(editorRef.current, 'current', dialect, handleRun)
              }
            >
              <Play />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            <span className="flex items-center gap-2">
              {translate('database.console.runStatementHint', 'Run statement at caret')}
              <ShortcutKeyCombo keys={runShortcutKeys()} />
            </span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!running}
              aria-label={translate('database.console.cancel', 'Cancel running statement')}
              onClick={() => void cancel(tab)}
            >
              <Square />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate('database.console.cancel', 'Cancel running statement')}
          </TooltipContent>
        </Tooltip>
        {running ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
        <div className="ml-auto">
          <DatabaseConnectionBadge connectionId={tab.connectionId} />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {text === null ? null : (
          <DatabaseConsoleEditor
            tabId={tab.id}
            connectionId={tab.connectionId}
            initialText={text}
            dialect={dialect}
            errorOffset={errorOffset}
            onChange={update}
            onRun={handleRun}
            onEditorReady={handleEditorReady}
          />
        )}
      </div>
      <div className="relative shrink-0 border-t border-border" style={{ height: size }}>
        <ResizeHandle
          edge="top"
          label={translate('database.console.resizeResults', 'Resize results')}
          handleProps={handleProps}
        />
        <DatabaseResultsPane tab={tab} />
      </div>
    </div>
  )
}
