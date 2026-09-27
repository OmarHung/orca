import React from 'react'
import { Loader2 } from 'lucide-react'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { DatabaseValueViewerToggle } from '../grid/DatabaseValueViewer'
import { DATABASE_MAX_BUFFERED_ROWS, type DatabaseResultTab } from './database-console-run-store'

/** Row count, paging state and timing under a result grid; `extra` sits after the count. */
export function DatabaseResultFooter({
  result,
  extra
}: {
  result: DatabaseResultTab
  extra?: React.ReactNode
}): React.JSX.Element {
  const rowCount = result.result.rows.length
  const capped = rowCount >= DATABASE_MAX_BUFFERED_ROWS && result.result.hasMore
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-xs text-muted-foreground">
      <span>
        {rowCount === 1 && !result.result.hasMore
          ? translate('database.results.oneRow', '1 row')
          : translate('database.results.rowCount', '{{value0}} rows', {
              value0: `${rowCount.toLocaleString(getIntlLocale())}${result.result.hasMore ? '+' : ''}`
            })}
      </span>
      {extra}
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
            { value0: DATABASE_MAX_BUFFERED_ROWS.toLocaleString(getIntlLocale()) }
          )}
        </span>
      ) : null}
      {result.loadError ? <span className="text-destructive">{result.loadError}</span> : null}
      <span className="ml-auto">
        {translate('database.results.duration', '{{value0}} ms', {
          value0: result.result.durationMs.toLocaleString(getIntlLocale())
        })}
      </span>
      <DatabaseValueViewerToggle />
    </div>
  )
}
