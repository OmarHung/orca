import React, { useCallback } from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { findDatabaseConnection } from '../database-connections-store'
import type { DatabaseRunTarget } from '../database-page-tabs'
import { DatabaseResultGrid } from '../grid/DatabaseResultGrid'
import { RESULT_INSERT_TABLE } from '../grid/database-grid-transfer'
import { DatabaseConsoleOutput } from './DatabaseConsoleOutput'
import { DatabaseResultFooter } from './DatabaseResultFooter'
import {
  DATABASE_MAX_BUFFERED_ROWS,
  OUTPUT_RESULT_ID,
  getConsoleRunState,
  useDatabaseConsoleRunStore
} from './database-console-run-store'

function ResultTabButton({
  label,
  title,
  active,
  onSelect
}: {
  label: string
  title?: string
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={title}
      onClick={onSelect}
      className={cn(
        'h-full shrink-0 border-b-2 border-transparent px-3 text-xs text-muted-foreground hover:text-foreground',
        active && 'border-foreground text-foreground'
      )}
    >
      {label}
    </button>
  )
}

export function DatabaseResultsPane({ tab }: { tab: DatabaseRunTarget }): React.JSX.Element {
  const runState = useDatabaseConsoleRunStore((state) => getConsoleRunState(state.consoles, tab.id))
  const selectResult = useDatabaseConsoleRunStore((state) => state.selectResult)
  const fetchMore = useDatabaseConsoleRunStore((state) => state.fetchMore)
  const active = runState.results.find((result) => result.id === runState.activeResultId) ?? null
  const activeId = active?.id ?? null
  const loadMore = useCallback(() => {
    if (activeId) {
      void fetchMore(tab, activeId)
    }
  }, [activeId, fetchMore, tab])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div role="tablist" className="flex h-8 shrink-0 items-stretch border-b border-border">
        {runState.results.map((result, index) => (
          <ResultTabButton
            key={result.id}
            label={translate('database.results.tab', 'Result {{value0}}', { value0: index + 1 })}
            title={result.statement}
            active={result.id === runState.activeResultId}
            onSelect={() => selectResult(tab.id, result.id)}
          />
        ))}
        <ResultTabButton
          label={translate('database.results.output', 'Output')}
          active={runState.activeResultId === OUTPUT_RESULT_ID || !active}
          onSelect={() => selectResult(tab.id, OUTPUT_RESULT_ID)}
        />
      </div>
      <div className="min-h-0 flex-1">
        {active ? (
          <DatabaseResultGrid
            columns={active.result.columns}
            rows={active.result.rows}
            canLoadMore={
              active.result.hasMore &&
              !active.loadingMore &&
              active.result.rows.length < DATABASE_MAX_BUFFERED_ROWS
            }
            onLoadMore={loadMore}
            exportTarget={{
              table: RESULT_INSERT_TABLE,
              driver: findDatabaseConnection(tab.connectionId)?.driver ?? 'postgres',
              fileName: 'result'
            }}
          />
        ) : (
          <DatabaseConsoleOutput log={runState.log} />
        )}
      </div>
      {active ? <DatabaseResultFooter result={active} /> : null}
    </div>
  )
}
