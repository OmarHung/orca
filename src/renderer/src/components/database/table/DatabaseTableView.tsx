import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCw, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { DatabaseDriver } from '../../../../../shared/database/database-connection-types'
import { DatabaseConnectionBadge } from '../DatabaseConnectionBadge'
import { connectionTintStyle } from '../database-connection-color'
import { DatabaseResultFooter } from '../console/DatabaseResultFooter'
import {
  DATABASE_MAX_BUFFERED_ROWS,
  getConsoleRunState,
  useDatabaseConsoleRunStore,
  type DatabaseConsoleLogOutcome
} from '../console/database-console-run-store'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import { useDatabasePageStore, type DatabaseTableTab } from '../database-page-store'
import { qualifiedRelationName } from '../../../../../shared/database/sql-identifiers'
import { DatabaseResultGrid } from '../grid/DatabaseResultGrid'
import type { GridSort } from '../grid/database-grid-sort'
import { buildTableDataSql, orderByForSort } from '../../../../../shared/database/table-data-sql'
import { useTableRowCount, type TableRowCount } from './use-table-row-count'

type TableQuery = { where: string; orderBy: string }

function runTableQuery(tab: DatabaseTableTab, driver: DatabaseDriver, query: TableQuery): void {
  useDatabasePageStore.getState().updateTableQuery(tab.id, query)
  const sql = buildTableDataSql({ driver, schema: tab.schema, relation: tab.relation, ...query })
  void useDatabaseConsoleRunStore
    .getState()
    .run(tab, [{ start: 0, end: sql.length, terminatorEnd: sql.length, text: sql }], {
      database: tab.database ?? undefined
    })
}

function FilterField({
  label,
  value,
  placeholder,
  onChange,
  onApply,
  onRevert
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  onApply: () => void
  onRevert: () => void
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 font-mono text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <Input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onApply()
          } else if (event.key === 'Escape') {
            onRevert()
          }
        }}
        className="h-7"
      />
    </label>
  )
}

function RowCountControl({
  rowCount,
  onCount
}: {
  rowCount: TableRowCount
  onCount: () => void
}): React.JSX.Element {
  switch (rowCount.status) {
    case 'idle':
      return (
        <Button variant="ghost" size="xs" onClick={onCount}>
          {translate('database.table.countRows', 'Count rows')}
        </Button>
      )
    case 'counting':
      return (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" />
          {translate('database.table.counting', 'Counting…')}
        </span>
      )
    case 'done':
      return (
        <span>
          {translate('database.table.totalRows', '{{value0}} total', { value0: rowCount.count })}
        </span>
      )
    case 'error':
      return (
        <span className="truncate text-destructive" title={rowCount.message}>
          {rowCount.message}
        </span>
      )
  }
}

function QueryError({
  outcome
}: {
  outcome: Extract<DatabaseConsoleLogOutcome, { kind: 'error' }>
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 p-3 font-mono text-xs">
      <p className="whitespace-pre-wrap text-destructive">{outcome.message}</p>
      {outcome.detail ? (
        <p className="whitespace-pre-wrap text-muted-foreground">{outcome.detail}</p>
      ) : null}
      {outcome.hint ? (
        <p className="whitespace-pre-wrap text-muted-foreground">{outcome.hint}</p>
      ) : null}
    </div>
  )
}

/** DataGrip-style table data viewer: filter, server-side sort, paging. */
export function DatabaseTableView({ tab }: { tab: DatabaseTableTab }): React.JSX.Element {
  const connection = useDatabaseConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === tab.connectionId)
  )
  const driver = connection?.driver
  const runState = useDatabaseConsoleRunStore((state) => getConsoleRunState(state.consoles, tab.id))
  const fetchMore = useDatabaseConsoleRunStore((state) => state.fetchMore)
  const cancel = useDatabaseConsoleRunStore((state) => state.cancel)
  const [draft, setDraft] = useState<TableQuery>({ where: tab.where, orderBy: tab.orderBy })
  const [headerSort, setHeaderSort] = useState<GridSort>(null)
  const { rowCount, count, reset: resetCount } = useTableRowCount(tab, driver ?? 'postgres')

  // Why keep the previous result while re-running: no flash, and column widths survive.
  const current = runState.results[0] ?? null
  const [lastResult, setLastResult] = useState(current)
  if (current && current !== lastResult) {
    setLastResult(current)
  }
  const shown = current ?? (runState.running ? lastResult : null)
  const lastOutcome = runState.log.at(-1)?.outcome
  const error = !runState.running && !current && lastOutcome?.kind === 'error' ? lastOutcome : null

  // Loads once per tab, including tabs restored from the last session.
  useEffect(() => {
    const state = getConsoleRunState(useDatabaseConsoleRunStore.getState().consoles, tab.id)
    if (driver && !state.running && state.results.length === 0 && state.log.length === 0) {
      runTableQuery(tab, driver, { where: tab.where, orderBy: tab.orderBy })
    }
  }, [driver, tab])

  const apply = (query: TableQuery): void => {
    if (driver) {
      resetCount()
      runTableQuery(tab, driver, query)
    }
  }
  const applyDraft = (): void => {
    if (draft.orderBy !== tab.orderBy) {
      setHeaderSort(null)
    }
    apply(draft)
  }
  const changeSort = (next: GridSort): void => {
    const column = next ? shown?.result.columns[next.column] : undefined
    const orderBy =
      next && column && driver ? orderByForSort(column.name, next.direction, driver) : ''
    setHeaderSort(next)
    setDraft((previous) => ({ ...previous, orderBy }))
    apply({ where: tab.where, orderBy })
  }
  const shownId = shown?.id ?? null
  const loadMore = useCallback(() => {
    if (shownId) {
      void fetchMore(tab, shownId)
    }
  }, [fetchMore, tab, shownId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2"
        style={connectionTintStyle(connection?.color ?? null)}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={runState.running || !driver}
          aria-label={translate('database.table.refresh', 'Refresh')}
          onClick={() => apply({ where: tab.where, orderBy: tab.orderBy })}
        >
          <RotateCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!runState.running}
          aria-label={translate('database.console.cancel', 'Cancel running statement')}
          onClick={() => void cancel(tab)}
        >
          <Square />
        </Button>
        <FilterField
          label="WHERE"
          value={draft.where}
          placeholder={translate('database.table.wherePlaceholder', 'e.g. id > 100')}
          onChange={(where) => setDraft((previous) => ({ ...previous, where }))}
          onApply={applyDraft}
          onRevert={() => setDraft((previous) => ({ ...previous, where: tab.where }))}
        />
        <FilterField
          label="ORDER BY"
          value={draft.orderBy}
          placeholder={translate('database.table.orderByPlaceholder', 'e.g. created_at desc')}
          onChange={(orderBy) => setDraft((previous) => ({ ...previous, orderBy }))}
          onApply={applyDraft}
          onRevert={() => setDraft((previous) => ({ ...previous, orderBy: tab.orderBy }))}
        />
        {runState.running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
        <DatabaseConnectionBadge connectionId={tab.connectionId} />
      </div>
      <div className="min-h-0 flex-1">
        {shown && driver ? (
          <DatabaseResultGrid
            columns={shown.result.columns}
            rows={shown.result.rows}
            canLoadMore={
              !runState.running &&
              shown.result.hasMore &&
              !shown.loadingMore &&
              shown.result.rows.length < DATABASE_MAX_BUFFERED_ROWS
            }
            onLoadMore={loadMore}
            serverSort={{ sort: headerSort, onChange: changeSort }}
            exportTarget={{
              table: qualifiedRelationName(tab.schema, tab.relation, driver),
              driver,
              fileName: tab.relation,
              result: {
                connectionId: tab.connectionId,
                consoleId: tab.consoleId,
                resultId: shown.result.resultId
              }
            }}
          />
        ) : null}
        {error ? <QueryError outcome={error} /> : null}
      </div>
      {shown ? (
        <DatabaseResultFooter
          result={shown}
          extra={<RowCountControl rowCount={rowCount} onCount={() => void count()} />}
        />
      ) : null}
    </div>
  )
}
