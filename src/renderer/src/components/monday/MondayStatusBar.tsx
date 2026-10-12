import React from 'react'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { MondaySchedule } from '../../../../shared/monday/monday-types'
import { updateMondayPrefs } from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'
import { MondayDueFlag } from './MondayScheduleVisuals'

function UndatedToggle({ count, shown }: { count: number; shown: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={shown}
      data-testid="monday-undated-toggle"
      onClick={() => updateMondayPrefs({ showUndated: !shown })}
      className={cn(
        'underline-offset-2 hover:text-foreground hover:underline',
        shown && 'text-foreground'
      )}
    >
      {translate('monday.status.undated', '{{value0}} without dates', { value0: count })}
    </button>
  )
}

function Legend(): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1">
        <span
          className="h-2.5 w-5 shrink-0 rounded-sm border-l-[3px]"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--muted-foreground) 24%, var(--background))',
            borderLeftColor: 'var(--muted-foreground)'
          }}
        />
        {translate('monday.legend.timeline', 'Timeline')}
      </span>
      <span className="flex items-center gap-1">
        <MondayDueFlag attention={false} />
        {translate('monday.legend.due', 'Due date')}
      </span>
      <span className="flex items-center gap-1">
        <MondayDueFlag attention />
        {translate('monday.legend.attention', 'Overdue, or due before the timeline ends')}
      </span>
    </div>
  )
}

export function MondayStatusBar(props: {
  schedule: MondaySchedule
  scheduledCount: number
  unscheduledCount: number
  undatedShown: boolean
}): React.JSX.Element {
  const { schedule, scheduledCount, unscheduledCount, undatedShown } = props
  const truncated = schedule.boards.filter((board) => board.truncated)
  const syncedAt = useMondayPageStore((state) => state.syncedAt)
  const syncedTime = new Intl.DateTimeFormat(getIntlLocale(), { timeStyle: 'short' }).format(
    syncedAt ?? schedule.fetchedAt
  )
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
      <span data-testid="monday-item-count">
        {translate('monday.status.items', '{{value0}} items with dates', {
          value0: scheduledCount
        })}
      </span>
      {unscheduledCount > 0 ? (
        <UndatedToggle count={unscheduledCount} shown={undatedShown} />
      ) : null}
      {truncated.map((board) => (
        <span key={board.boardId} className="text-destructive">
          {translate(
            'monday.status.truncated',
            '{{value0}}: only the first {{value1}} items are shown',
            {
              value0: board.boardName,
              value1: board.items.length
            }
          )}
        </span>
      ))}
      <div className="ml-auto flex items-center gap-4">
        <Legend />
        <span>
          {translate('monday.status.syncedAt', 'Synced {{value0}}', { value0: syncedTime })}
        </span>
      </div>
    </div>
  )
}
