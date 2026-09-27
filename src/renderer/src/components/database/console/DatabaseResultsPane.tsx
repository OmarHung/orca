import React, { useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DatabaseConsoleTab } from '../database-page-store'
import { DatabaseResultGrid } from '../grid/DatabaseResultGrid'
import { DatabaseConsoleOutput } from './DatabaseConsoleOutput'
import {
  DATABASE_MAX_BUFFERED_ROWS,
  OUTPUT_RESULT_ID,
  getConsoleRunState,
  useDatabaseConsoleRunStore,
  type DatabaseResultTab
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

function ResultFooter({ result }: { result: DatabaseResultTab }): React.JSX.Element {
  const rowCount = result.result.rows.length
  const capped = rowCount >= DATABASE_MAX_BUFFERED_ROWS && result.result.hasMore
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-xs text-muted-foreground">
      <span>
        {rowCount === 1 && !result.result.hasMore
          ? translate('database.results.oneRow', '1 row')
          : translate('database.results.rowCount', '{{value0}} rows', {
              value0: `${rowCount.toLocaleString()}${result.result.hasMore ? '+' : ''}`
            })}
      </span>
      {result.loadingMore ? (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" />
          {translate('database.results.loadingMore', 'Loading more…')}
        </span>
      ) : null}
      {capped ? (
        <span>
          {translate(
            'database.results.capped',
            'Showing the first {{value0}} rows. Add a LIMIT or filter to see the rest.',
            { value0: DATABASE_MAX_BUFFERED_ROWS.toLocaleString() }
          )}
        </span>
      ) : null}
      {result.loadError ? <span className="text-destructive">{result.loadError}</span> : null}
      <span className="ml-auto">
        {translate('database.results.duration', '{{value0}} ms', {
          value0: result.result.durationMs.toLocaleString()
        })}
      </span>
    </div>
  )
}

export function DatabaseResultsPane({ tab }: { tab: DatabaseConsoleTab }): React.JSX.Element {
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
          />
        ) : (
          <DatabaseConsoleOutput log={runState.log} />
        )}
      </div>
      {active ? <ResultFooter result={active} /> : null}
    </div>
  )
}
