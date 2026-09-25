import React from 'react'
import { cn } from '@/lib/utils'
import type { GitHistoryItemViewModel } from '../../../../../shared/git-history-graph'
import { dedupeRemoteTrackingRefs } from '../../../../../shared/git-history-ref-display'
import { GitHistoryGraphSvg } from '../../right-sidebar/source-control/sync/git-history-graph-svg'
import { GitHistoryRefBadge } from '../../right-sidebar/source-control/sync/git-history-row'
import { formatGitLogDate, formatGitLogFullDate } from './git-log-format'

export const GIT_LOG_GRID_COLUMNS = 'grid-cols-[minmax(0,1fr)_8rem_9rem_5.5rem]'
const MAX_VISIBLE_REFS = 3

type GitLogTableRowProps = React.HTMLAttributes<HTMLButtonElement> & {
  viewModel: GitHistoryItemViewModel
  selected: boolean
  /** Lanes only make sense over the unfiltered, contiguous log. */
  showGraph: boolean
  onSelectCommit: (id: string) => void
}

export const GitLogTableRow = React.forwardRef<HTMLButtonElement, GitLogTableRowProps>(
  function GitLogTableRow(
    { viewModel, selected, showGraph, onSelectCommit, className, ...rootProps },
    ref
  ): React.JSX.Element {
    const item = viewModel.historyItem
    const refs = dedupeRemoteTrackingRefs(item.references ?? [])
    const visibleRefs = refs.slice(0, MAX_VISIBLE_REFS)
    const hiddenRefCount = refs.length - visibleRefs.length

    return (
      <button
        {...rootProps}
        ref={ref}
        type="button"
        data-current={selected ? 'true' : undefined}
        data-testid="git-log-row"
        className={cn(
          'grid h-6 w-full min-w-0 items-center gap-x-3 px-2 text-left text-xs',
          GIT_LOG_GRID_COLUMNS,
          selected ? 'bg-accent' : 'hover:bg-accent/50',
          className
        )}
        onClick={() => onSelectCommit(item.id)}
      >
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {showGraph ? <GitHistoryGraphSvg viewModel={viewModel} /> : null}
          {visibleRefs.map((itemRef) => (
            <GitHistoryRefBadge key={itemRef.id} itemRef={itemRef} />
          ))}
          {hiddenRefCount > 0 ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">+{hiddenRefCount}</span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-foreground" title={item.message}>
            {item.subject}
          </span>
        </span>
        <span className="truncate text-muted-foreground" title={item.authorEmail ?? item.author}>
          {item.author}
        </span>
        <span
          className="truncate tabular-nums text-muted-foreground"
          title={formatGitLogFullDate(item.timestamp)}
        >
          {formatGitLogDate(item.timestamp)}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={item.id}>
          {item.displayId ?? item.id.slice(0, 8)}
        </span>
      </button>
    )
  }
)
