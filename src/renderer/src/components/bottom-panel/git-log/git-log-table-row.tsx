import React from 'react'
import { cn } from '@/lib/utils'
import type { GitHistoryItemViewModel } from '../../../../../shared/git-history-graph'
import { dedupeRemoteTrackingRefs } from '../../../../../shared/git-history-ref-display'
import { GitHistoryGraphSvg } from '../../right-sidebar/source-control/sync/git-history-graph-svg'
import { GitHistoryRefBadge } from '../../right-sidebar/source-control/sync/git-history-row'
import { formatGitLogDate, formatGitLogFullDate } from './git-log-format'

const MAX_VISIBLE_REFS = 3

type GitLogTableRowProps = React.HTMLAttributes<HTMLButtonElement> & {
  viewModel: GitHistoryItemViewModel
  selected: boolean
  /** Lanes only make sense over the unfiltered, contiguous log. */
  showGraph: boolean
  gridTemplateColumns: string
  onSelectCommit: (id: string) => void
}

export const GitLogTableRow = React.forwardRef<HTMLButtonElement, GitLogTableRowProps>(
  function GitLogTableRow(
    {
      viewModel,
      selected,
      showGraph,
      gridTemplateColumns,
      onSelectCommit,
      className,
      ...rootProps
    },
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
          selected ? 'bg-accent' : 'hover:bg-accent/50',
          className
        )}
        style={{ gridTemplateColumns }}
        onClick={() => onSelectCommit(item.id)}
      >
        <span
          className="flex min-w-0 items-center gap-1.5 overflow-hidden"
          data-git-log-col="subject"
        >
          {showGraph ? <GitHistoryGraphSvg viewModel={viewModel} /> : null}
          {visibleRefs.map((itemRef) => (
            <GitHistoryRefBadge key={itemRef.id} itemRef={itemRef} />
          ))}
          {hiddenRefCount > 0 ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">+{hiddenRefCount}</span>
          ) : null}
          <span
            className="min-w-0 flex-1 truncate text-foreground"
            title={item.message}
            data-git-log-text=""
          >
            {item.subject}
          </span>
        </span>
        <span
          className="truncate text-muted-foreground"
          title={item.authorEmail ?? item.author}
          data-git-log-col="author"
        >
          {item.author}
        </span>
        <span
          className="truncate tabular-nums text-muted-foreground"
          title={formatGitLogFullDate(item.timestamp)}
          data-git-log-col="date"
        >
          {formatGitLogDate(item.timestamp)}
        </span>
        <span
          className="truncate font-mono text-[11px] text-muted-foreground"
          title={item.id}
          data-git-log-col="hash"
        >
          {item.displayId ?? item.id.slice(0, 8)}
        </span>
      </button>
    )
  }
)
