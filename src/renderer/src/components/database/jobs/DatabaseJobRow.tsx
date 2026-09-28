import React from 'react'
import { Ban, CircleAlert, CircleCheck, FolderOpen, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from '@/components/status-bar/workspace-space-format'
import { translate } from '@/i18n/i18n'
import type { DatabaseDumpJob, DatabaseJobStatus } from './database-jobs-store'

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

function RunningDetail({ job }: { job: DatabaseDumpJob }): React.JSX.Element {
  const progress = job.progress
  const percent =
    progress && progress.tableCount > 0 ? (progress.tablesDone / progress.tableCount) * 100 : 0
  return (
    <div className="flex flex-col gap-1.5">
      <Progress value={percent} aria-label={translate('database.jobs.progress', 'Progress')} />
      <p className="truncate text-xs text-muted-foreground tabular-nums">
        {!progress
          ? translate('database.jobs.starting', 'Starting…')
          : progress.rows === null
            ? translate(
                'database.jobs.dumpRunningNoRows',
                'Tables: {{value0}} of {{value1}} · {{value2}}',
                {
                  value0: String(progress.tablesDone),
                  value1: String(progress.tableCount),
                  value2: formatBytes(progress.bytes)
                }
              )
            : translate(
                'database.jobs.dumpRunning',
                'Tables: {{value0}} of {{value1}} · Rows: {{value2}} · {{value3}}',
                {
                  value0: String(progress.tablesDone),
                  value1: String(progress.tableCount),
                  value2: String(progress.rows),
                  value3: formatBytes(progress.bytes)
                }
              )}
        {progress?.currentTable ? ` · ${progress.currentTable}` : ''}
      </p>
    </div>
  )
}

function FinishedDetail({ job }: { job: DatabaseDumpJob }): React.JSX.Element {
  const summary = job.summary
  if (!summary) {
    return <p className="text-xs break-words text-destructive">{job.error}</p>
  }
  if (summary.cancelled) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('database.jobs.dumpCancelledDetail', 'Cancelled; its files were removed.')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground tabular-nums">
        {summary.rows === null
          ? translate(
              'database.jobs.dumpFinishedNoRows',
              'Tables: {{value0}} · {{value1}} · {{value2}} s',
              {
                value0: String(summary.tables),
                value1: formatBytes(summary.bytes),
                value2: (summary.durationMs / 1000).toFixed(1)
              }
            )
          : translate(
              'database.jobs.dumpFinished',
              'Tables: {{value0}} · Rows: {{value1}} · {{value2}} · {{value3}} s',
              {
                value0: String(summary.tables),
                value1: String(summary.rows),
                value2: formatBytes(summary.bytes),
                value3: (summary.durationMs / 1000).toFixed(1)
              }
            )}
      </p>
      {summary.notes.length > 0 ? (
        <ul aria-label={translate('database.jobs.notes', 'Notes')} className="flex flex-col gap-1">
          {summary.notes.map((note) => (
            <li key={note} className="rounded-sm bg-muted px-2 py-1 text-xs text-foreground">
              {note}
            </li>
          ))}
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
  job: DatabaseDumpJob
  onCancel: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const running = job.status === 'running'
  const what = job.dataOnly
    ? translate('database.jobs.exportOf', 'Export of {{value0}}', { value0: job.source })
    : translate('database.jobs.dumpOf', 'Dump of {{value0}}', { value0: job.source })
  const title = job.tool
    ? translate('database.jobs.withTool', '{{value0}} with {{value1}}', {
        value0: what,
        value1: job.tool
      })
    : what
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <StatusIcon status={job.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={title}>
            {title}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={job.destination}>
            {job.destination}
          </p>
        </div>
        {job.status === 'done' ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={translate('database.jobs.showInFolder', 'Show in Folder')}
            title={translate('database.jobs.showInFolder', 'Show in Folder')}
            onClick={() => void window.api.shell.openInFileManager(job.destination)}
          >
            <FolderOpen />
          </Button>
        ) : null}
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
