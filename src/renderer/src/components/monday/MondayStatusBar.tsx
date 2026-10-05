import React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getIntlLocale, translate } from '@/i18n/i18n'
import type { MondaySchedule } from '../../../../shared/monday/monday-types'
import type { MondayCalendarEntry } from './monday-calendar-model'
import { selectMondayItem } from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'
import { MondayDueFlag } from './MondayScheduleVisuals'

function UndatedItems({ entries }: { entries: readonly MondayCalendarEntry[] }): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="underline-offset-2 hover:text-foreground hover:underline">
          {translate('monday.status.undated', '{{value0}} without dates', {
            value0: entries.length
          })}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="scrollbar-sleek max-h-72 overflow-y-auto p-1">
          {entries.map((entry) => (
            <button
              key={entry.item.id}
              type="button"
              onClick={() => selectMondayItem(entry.item.id)}
              className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="truncate">{entry.item.name}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {entry.boardName}
                {entry.item.groupTitle ? ` · ${entry.item.groupTitle}` : ''}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
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
  unscheduled: readonly MondayCalendarEntry[]
}): React.JSX.Element {
  const { schedule, scheduledCount, unscheduled } = props
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
      {unscheduled.length > 0 ? <UndatedItems entries={unscheduled} /> : null}
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
