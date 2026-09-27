import React, { useEffect, useRef } from 'react'
import { CircleAlert, CircleCheck, CircleSlash } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  DatabaseConsoleLogEntry,
  DatabaseConsoleLogOutcome
} from './database-console-run-store'

function describeOutcome(outcome: DatabaseConsoleLogOutcome): string {
  switch (outcome.kind) {
    case 'rows':
      if (outcome.rowCount === 1 && !outcome.hasMore) {
        return translate('database.output.oneRow', '1 row retrieved in {{value0}} ms', {
          value0: outcome.durationMs.toLocaleString()
        })
      }
      return translate('database.output.rows', '{{value0}} rows retrieved in {{value1}} ms', {
        value0: `${outcome.rowCount.toLocaleString()}${outcome.hasMore ? '+' : ''}`,
        value1: outcome.durationMs.toLocaleString()
      })
    case 'command':
      if (!outcome.command) {
        // Batches (SQL Server) and plain statements don't always name what they did.
        return outcome.rowCount === null
          ? translate('database.output.completed', 'Completed in {{value0}} ms', {
              value0: outcome.durationMs.toLocaleString()
            })
          : translate('database.output.rowsAffected', '{{value0}} rows affected in {{value1}} ms', {
              value0: outcome.rowCount.toLocaleString(),
              value1: outcome.durationMs.toLocaleString()
            })
      }
      return outcome.rowCount === null
        ? translate('database.output.command', '{{value0}} completed in {{value1}} ms', {
            value0: outcome.command,
            value1: outcome.durationMs.toLocaleString()
          })
        : translate(
            'database.output.commandRows',
            '{{value0}}: {{value1}} rows affected in {{value2}} ms',
            {
              value0: outcome.command,
              value1: outcome.rowCount.toLocaleString(),
              value2: outcome.durationMs.toLocaleString()
            }
          )
    case 'cancelled':
      return translate('database.output.cancelled', 'Cancelled')
    case 'error':
      return [outcome.message, outcome.detail, outcome.hint].filter(Boolean).join('\n')
  }
}

function OutcomeIcon({ outcome }: { outcome: DatabaseConsoleLogOutcome }): React.JSX.Element {
  if (outcome.kind === 'error') {
    return <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
  }
  if (outcome.kind === 'cancelled') {
    return <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
  }
  return <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
}

export function DatabaseConsoleOutput({
  log
}: {
  log: DatabaseConsoleLogEntry[]
}): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Why a block body: Chromium's scrollIntoView returns a Promise, which React would call as a cleanup.
    void endRef.current?.scrollIntoView({ block: 'end' })
  }, [log.length])

  if (log.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {translate('database.output.empty', 'Run a statement to see its results here.')}
      </div>
    )
  }
  return (
    <div className="h-full overflow-y-auto scrollbar-sleek p-2 font-mono text-xs">
      {log.map((entry) => (
        <div key={entry.id} className="flex gap-2 border-b border-border/50 py-1.5 last:border-b-0">
          <OutcomeIcon outcome={entry.outcome} />
          <div className="min-w-0 flex-1">
            <div className="flex gap-2 text-muted-foreground">
              <span className="shrink-0">{new Date(entry.at).toLocaleTimeString()}</span>
              <span className="truncate" title={entry.statement}>
                {entry.statement}
              </span>
            </div>
            <div
              className={cn(
                'whitespace-pre-wrap text-foreground',
                entry.outcome.kind === 'error' && 'text-destructive'
              )}
            >
              {describeOutcome(entry.outcome)}
            </div>
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
