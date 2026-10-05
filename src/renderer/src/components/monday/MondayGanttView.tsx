import React, { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { fromDayNumber, toDayNumber } from '../../../../shared/monday/monday-schedule'
import {
  buildMonthGrid,
  mondayWeekdayIndex,
  type MondayCalendarEntry
} from './monday-calendar-model'
import { formatMondayShortMonth, mondayWeekdayNames } from './monday-date-format'
import { buildMondayGantt, type MondayGanttRow } from './monday-gantt-model'
import { selectMondayItem } from './monday-page-actions'
import { MondayItemHoverSummary } from './MondayItemHoverSummary'
import {
  MondayDueFlag,
  mondayDueNeedsAttention,
  mondayStatusSurfaceStyle
} from './MondayScheduleVisuals'

const DAY_WIDTH = 28
const LABEL_WIDTH = 280

type GanttViewProps = {
  entries: readonly MondayCalendarEntry[]
  boardOrder: readonly string[]
  anchorMonth: string
  today: string
  selectedItemId: string | null
}

function GanttHeader({ firstDay, days }: { firstDay: number; days: number }): React.JSX.Element {
  const weekdays = useMemo(() => mondayWeekdayNames('narrow'), [])
  return (
    <div className="sticky top-0 z-20 flex border-b border-border bg-background">
      <div
        className="sticky left-0 z-10 shrink-0 border-r border-border bg-background"
        style={{ width: LABEL_WIDTH }}
      />
      {Array.from({ length: days }, (_, index) => {
        const day = firstDay + index
        const iso = fromDayNumber(day)
        const showMonth = index === 0 || iso.endsWith('-01')
        return (
          <div
            key={day}
            className="flex shrink-0 flex-col items-center py-1 text-[11px] leading-tight text-muted-foreground"
            style={{ width: DAY_WIDTH }}
          >
            <span className="h-3.5 whitespace-nowrap font-semibold text-foreground">
              {showMonth ? formatMondayShortMonth(day) : ''}
            </span>
            <span className="tabular-nums">{Number(iso.slice(8, 10))}</span>
            <span>{weekdays[mondayWeekdayIndex(day)]}</span>
          </div>
        )
      })}
    </div>
  )
}

function GanttRowView({
  row,
  today,
  selected
}: {
  row: MondayGanttRow
  today: string
  selected: boolean
}): React.JSX.Element {
  const { item, schedule } = row.entry
  const attention = mondayDueNeedsAttention(schedule)
  const select = (): void => selectMondayItem(item.id)
  return (
    <div
      className="flex h-7 border-b border-border/60"
      data-selected={selected ? 'true' : undefined}
    >
      <button
        type="button"
        onClick={select}
        className={cn(
          'sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-background px-3 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          selected && 'bg-accent'
        )}
        style={{ width: LABEL_WIDTH }}
      >
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: item.status?.color ?? 'var(--muted-foreground)' }}
        />
        <span
          className={cn(
            'truncate',
            item.status?.isDone && 'text-muted-foreground line-through',
            schedule.overdue && 'text-destructive'
          )}
        >
          {item.name}
        </span>
      </button>
      <div className="relative flex-1">
        {row.bar ? (
          <MondayItemHoverSummary entry={row.entry} today={today}>
            <button
              type="button"
              data-testid="monday-gantt-bar"
              onClick={select}
              className={cn(
                'absolute top-1 h-5 rounded-sm border-l-[3px] outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring',
                row.bar.clippedStart && 'rounded-l-none border-l-0',
                selected && 'ring-2 ring-ring'
              )}
              style={{
                left: row.bar.startCol * DAY_WIDTH + 1,
                width: (row.bar.endCol - row.bar.startCol + 1) * DAY_WIDTH - 2,
                ...mondayStatusSurfaceStyle(item)
              }}
            />
          </MondayItemHoverSummary>
        ) : null}
        {schedule.dueBeforeEnd && row.bar && row.dueCol !== null && row.dueCol < row.bar.endCol ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1 h-5 bg-destructive/20"
            style={{
              left: (row.dueCol + 1) * DAY_WIDTH,
              width: (row.bar.endCol - row.dueCol) * DAY_WIDTH - 1
            }}
          />
        ) : null}
        {row.dueCol !== null ? (
          <MondayItemHoverSummary entry={row.entry} today={today}>
            <button
              type="button"
              data-testid="monday-gantt-flag"
              onClick={select}
              aria-label={item.name}
              className="absolute top-0 flex h-7 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ left: row.dueCol * DAY_WIDTH, width: DAY_WIDTH }}
            >
              <MondayDueFlag attention={attention} className="size-3.5" />
            </button>
          </MondayItemHoverSummary>
        ) : null}
      </div>
    </div>
  )
}

function DayColumns({
  firstDay,
  days,
  today
}: {
  firstDay: number
  days: number
  today: string
}): React.JSX.Element {
  const todayCol = toDayNumber(today) - firstDay
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 flex"
      style={{ left: LABEL_WIDTH }}
    >
      {Array.from({ length: days }, (_, index) => (
        <div
          key={index}
          className={cn(
            'h-full shrink-0 border-r border-border/40',
            mondayWeekdayIndex(firstDay + index) >= 5 && 'bg-muted/40'
          )}
          style={{ width: DAY_WIDTH }}
        />
      ))}
      {todayCol >= 0 && todayCol < days ? (
        <div
          className="absolute inset-y-0 w-0.5 bg-primary/60"
          style={{ left: todayCol * DAY_WIDTH + DAY_WIDTH / 2 }}
        />
      ) : null}
    </div>
  )
}

export function MondayGanttView(props: GanttViewProps): React.JSX.Element {
  const { entries, boardOrder, anchorMonth, today, selectedItemId } = props
  const grid = useMemo(() => buildMonthGrid(anchorMonth), [anchorMonth])
  const days = grid.lastDay - grid.firstDay + 1
  const groups = useMemo(
    () => buildMondayGantt(entries, boardOrder, grid.firstDay, grid.lastDay),
    [entries, boardOrder, grid]
  )
  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto" data-testid="monday-gantt-view">
      <div className="relative min-h-full" style={{ width: LABEL_WIDTH + days * DAY_WIDTH }}>
        <DayColumns firstDay={grid.firstDay} days={days} today={today} />
        <GanttHeader firstDay={grid.firstDay} days={days} />
        {groups.map((group) => (
          <div key={group.boardId} className="relative">
            <div className="relative flex h-7 border-b border-border bg-muted">
              <div
                className="sticky left-0 flex items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                style={{ width: LABEL_WIDTH }}
              >
                <span className="truncate">{group.boardName}</span>
                <span className="ml-auto pl-2 tabular-nums">{group.rows.length}</span>
              </div>
            </div>
            {group.rows.map((row) => (
              <GanttRowView
                key={row.entry.item.id}
                row={row}
                today={today}
                selected={row.entry.item.id === selectedItemId}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
