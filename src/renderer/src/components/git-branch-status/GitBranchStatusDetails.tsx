import React from 'react'
import {
  ArrowDown,
  ArrowUp,
  FilePen,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  type LucideIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import type { BranchStatusSummary } from './branch-status-model'
import type { GitAutoFetchRecord } from './git-auto-fetch-store'

export type GitBranchStatusDetailsProps = {
  summary: BranchStatusSummary
  /** Reference time for "last ran …" copy. */
  now: number
  autoFetch: {
    enabled: boolean
    intervalMinutes: number
    record: GitAutoFetchRecord | undefined
    running: boolean
  }
  canFetch: boolean
  isFetching: boolean
  onFetch: () => void
  onOpenSourceControl: () => void
  onOpenSettings: () => void
}

type SyncLine = { key: string; icon: LucideIcon | null; text: string }

function syncLines(summary: BranchStatusSummary): SyncLine[] {
  if (!summary.hasUpstream) {
    return [
      {
        key: 'none',
        icon: null,
        text: translate('gitBranchStatus.noUpstream', 'No upstream branch')
      }
    ]
  }
  const lines: SyncLine[] = []
  if (summary.ahead > 0) {
    lines.push({
      key: 'ahead',
      icon: ArrowUp,
      text:
        summary.ahead === 1
          ? translate('gitBranchStatus.aheadCount_one', '{{count}} commit to push', { count: 1 })
          : translate('gitBranchStatus.aheadCount_other', '{{count}} commits to push', {
              count: summary.ahead
            })
    })
  }
  if (summary.behind > 0) {
    lines.push({
      key: 'behind',
      icon: ArrowDown,
      text:
        summary.behind === 1
          ? translate('gitBranchStatus.behindCount_one', '{{count}} commit to pull', { count: 1 })
          : translate('gitBranchStatus.behindCount_other', '{{count}} commits to pull', {
              count: summary.behind
            })
    })
  }
  if (lines.length === 0) {
    lines.push({
      key: 'even',
      icon: null,
      text: translate('gitBranchStatus.upToDate', 'Up to date with {{upstream}}', {
        upstream: summary.upstreamName ?? ''
      })
    })
  }
  return lines
}

function changesLine(summary: BranchStatusSummary): string {
  if (summary.changedFileCount === 0) {
    return translate('gitBranchStatus.noChanges', 'No uncommitted changes')
  }
  if (summary.changedFileCountIsPartial) {
    return translate(
      'gitBranchStatus.changedFilesPartial',
      'More than {{count}} files with uncommitted changes',
      { count: summary.changedFileCount }
    )
  }
  return summary.changedFileCount === 1
    ? translate('gitBranchStatus.changedFiles_one', '{{count}} file with uncommitted changes', {
        count: 1
      })
    : translate('gitBranchStatus.changedFiles_other', '{{count}} files with uncommitted changes', {
        count: summary.changedFileCount
      })
}

function AutoFetchLine({
  autoFetch,
  now
}: {
  autoFetch: GitBranchStatusDetailsProps['autoFetch']
  now: number
}): React.JSX.Element {
  if (!autoFetch.enabled) {
    return <span>{translate('gitBranchStatus.autoFetchOff', 'Auto fetch is off')}</span>
  }
  const every = translate('gitBranchStatus.autoFetchEvery', 'Auto fetch every {{minutes}} min', {
    minutes: autoFetch.intervalMinutes
  })
  if (autoFetch.running) {
    return <span>{`${every} · ${translate('gitBranchStatus.fetching', 'Fetching…')}`}</span>
  }
  const record = autoFetch.record
  if (!record) {
    return <span>{every}</span>
  }
  const when = formatUiRelativeTime(record.lastAttemptAt - now)
  if (record.error) {
    return (
      <span className="text-destructive">
        {translate('gitBranchStatus.autoFetchFailed', 'Auto fetch failed {{when}}: {{error}}', {
          when,
          error: record.error
        })}
      </span>
    )
  }
  return (
    <span>
      {`${every} · ${translate('gitBranchStatus.autoFetchedAt', 'last ran {{when}}', { when })}`}
    </span>
  )
}

/** Popover body for the status-bar branch segment. */
export function GitBranchStatusDetails({
  summary,
  now,
  autoFetch,
  canFetch,
  isFetching,
  onFetch,
  onOpenSourceControl,
  onOpenSettings
}: GitBranchStatusDetailsProps): React.JSX.Element {
  return (
    <div className="flex flex-col text-xs">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-border px-3 py-2">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground select-text">{summary.label}</span>
        {summary.isDetached ? (
          <span className="shrink-0 text-muted-foreground">
            {translate('gitBranchStatus.detached', '(detached HEAD)')}
          </span>
        ) : null}
      </div>
      <div className="space-y-1.5 px-3 py-2 text-muted-foreground">
        {summary.hasUpstream ? (
          <div className="truncate select-text">
            {translate('gitBranchStatus.upstream', 'Tracking {{upstream}}', {
              upstream: summary.upstreamName ?? ''
            })}
          </div>
        ) : null}
        {syncLines(summary).map(({ key, icon: Icon, text }) => (
          <div key={key} className="flex items-center gap-1.5">
            {Icon ? <Icon className="size-3 shrink-0" /> : null}
            <span>{text}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <FilePen className="size-3 shrink-0" />
          <span>{changesLine(summary)}</span>
        </div>
        {summary.conflictCount > 0 ? (
          <div className="text-destructive">
            {summary.conflictCount === 1
              ? translate('gitBranchStatus.conflicts_one', '{{count}} file with conflicts', {
                  count: 1
                })
              : translate('gitBranchStatus.conflicts_other', '{{count}} files with conflicts', {
                  count: summary.conflictCount
                })}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <RefreshCw className="size-3 shrink-0" />
          <AutoFetchLine autoFetch={autoFetch} now={now} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
        <Button variant="outline" size="xs" disabled={!canFetch} onClick={onFetch}>
          {isFetching ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          {translate('gitBranchStatus.fetch', 'Fetch')}
        </Button>
        <Button variant="ghost" size="xs" onClick={onOpenSourceControl}>
          {translate('gitBranchStatus.openSourceControl', 'Source Control')}
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="xs" onClick={onOpenSettings}>
          {translate('gitBranchStatus.openSettings', 'Settings')}
        </Button>
      </div>
    </div>
  )
}
