import React from 'react'
import { Ban, CircleAlert, CircleCheck, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { translate } from '@/i18n/i18n'
import type { DatabaseScriptSummary } from '../../../../../shared/database/database-script-types'
import type { DatabaseJobStatus, DatabaseScriptJob } from './database-jobs-store'

const SHOWN_FAILURES = 5

function StatusIcon({ status }: { status: DatabaseJobStatus }): React.JSX.Element {
  switch (status) {
    case 'running':
      return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
    case 'done':
      return <CircleCheck className="size-4 shrink-0 text-status-success" />
    case 'failed':
      return <CircleAlert className="size-4 shrink-0 text-destructive" />
    case 'cancelled':
      return <Ban className="size-4 shrink-0 text-muted-foreground" />
  }
}

function jobTitle(job: DatabaseScriptJob): string {
  const first = job.files[0]?.name ?? ''
  return job.files.length > 1
    ? translate('database.jobs.titleMany', '{{value0}} and {{value1}} more', {
        value0: first,
        value1: String(job.files.length - 1)
      })
    : first
}

function transactionNote(summary: DatabaseScriptSummary): string | null {
  switch (summary.transaction) {
    case 'committed':
      return translate('database.jobs.committed', 'Committed')
    case 'rolled-back':
      return translate('database.jobs.rolledBack', 'Rolled back')
    case null:
      return null
  }
}

function RunningDetail({ job }: { job: DatabaseScriptJob }): React.JSX.Element {
  const progress = job.progress
  const percent =
    progress && progress.totalBytes > 0 ? (progress.bytesDone / progress.totalBytes) * 100 : 0
  return (
    <div className="flex flex-col gap-1.5">
      <Progress value={percent} aria-label={translate('database.jobs.progress', 'Progress')} />
      <p className="text-xs text-muted-foreground">
        {progress
          ? translate(
              'database.jobs.runningDetail',
              'File {{value0}} of {{value1}} · Statements: {{value2}} · Errors: {{value3}}',
              {
                value0: String(progress.fileIndex + 1),
                value1: String(progress.fileCount),
                value2: String(progress.statements),
                value3: String(progress.failed)
              }
            )
          : translate('database.jobs.starting', 'Starting…')}
      </p>
    </div>
  )
}

function FinishedDetail({ job }: { job: DatabaseScriptJob }): React.JSX.Element {
  const summary = job.summary
  if (!summary) {
    return <p className="text-xs text-destructive">{job.error}</p>
  }
  const note = transactionNote(summary)
  const hidden = summary.failures.length - SHOWN_FAILURES + summary.failuresOmitted
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">
        {translate(
          'database.jobs.finishedDetail',
          'Statements: {{value0}} · Errors: {{value1}} · {{value2}} s',
          {
            value0: String(summary.statements),
            value1: String(summary.failed),
            value2: (summary.durationMs / 1000).toFixed(1)
          }
        )}
        {note ? ` · ${note}` : ''}
      </p>
      {summary.failures.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {summary.failures.slice(0, SHOWN_FAILURES).map((failure) => (
            <li
              key={`${failure.file}:${failure.line}:${failure.statement}`}
              title={failure.statement}
              className="rounded-sm bg-destructive/10 px-2 py-1 text-xs"
            >
              <span className="font-mono text-muted-foreground">
                {failure.file ? `${failure.file}:${failure.line}` : failure.statement}
              </span>{' '}
              <span className="text-foreground">{failure.message}</span>
            </li>
          ))}
          {hidden > 0 ? (
            <li className="text-xs text-muted-foreground">
              {translate('database.jobs.moreErrors', 'and {{value0}} more', {
                value0: String(hidden)
              })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

export function DatabaseJobRow({
  job,
  onCancel,
  onDismiss
}: {
  job: DatabaseScriptJob
  onCancel: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const running = job.status === 'running'
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <StatusIcon status={job.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{jobTitle(job)}</p>
          <p className="truncate text-xs text-muted-foreground">{job.target}</p>
        </div>
        {running ? (
          <Button variant="ghost" size="sm" disabled={job.cancelling} onClick={onCancel}>
            {job.cancelling
              ? translate('database.jobs.cancelling', 'Cancelling…')
              : translate('database.jobs.cancel', 'Cancel')}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={translate('database.jobs.dismiss', 'Dismiss')}
            onClick={onDismiss}
          >
            <X />
          </Button>
        )}
      </div>
      {running ? <RunningDetail job={job} /> : <FinishedDetail job={job} />}
    </div>
  )
}
