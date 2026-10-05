import React, { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { fromDayNumber, toDayNumber } from '../../../../shared/monday/monday-schedule'
import {
  buildMonthGrid,
  type MondayCalendarEntry,
  type MondayMonthGrid
} from './monday-calendar-model'
import { formatMondayShortMonth, mondayWeekdayNames } from './monday-date-format'
import { selectMondayItem } from './monday-page-actions'
import { layoutMondayWeek, type MondayWeekBar, type MondayWeekSlot } from './monday-week-layout'
import { MondayItemHoverSummary } from './MondayItemHoverSummary'
import {
  MondayDueFlag,
  mondayDueNeedsAttention,
  mondayStatusSurfaceStyle
} from './MondayScheduleVisuals'

type MonthViewProps = {
  entries: readonly MondayCalendarEntry[]
  anchorMonth: string
  today: string
  selectedItemId: string | null
}

function gridColumn(slot: MondayWeekSlot): React.CSSProperties {
  return { gridColumn: `${slot.startCol + 1} / ${slot.endCol + 2}` }
}

/** Share of the bar (0–100) after the due date: the part of the plan past its deadline. */
function overrunStartPercent(slot: MondayWeekBar, weekStart: number): number | null {
  const { due, dueBeforeEnd } = slot.entry.schedule
  if (!dueBeforeEnd || !due) {
    return null
  }
  const from = Math.max(toDayNumber(due) - weekStart + 1, slot.startCol)
  if (from > slot.endCol) {
    return null
  }
  return ((from - slot.startCol) / (slot.endCol - slot.startCol + 1)) * 100
}

function BarSlot({
  slot,
  weekStart,
  today,
  selected
}: {
  slot: MondayWeekBar
  weekStart: number
  today: string
  selected: boolean
}): React.JSX.Element {
  const { item, schedule } = slot.entry
  const columns = slot.endCol - slot.startCol + 1
  const overrun = overrunStartPercent(slot, weekStart)
  const flagAtEnd = slot.dueCol === slot.endCol
  return (
    <MondayItemHoverSummary entry={slot.entry} today={today}>
      <button
        type="button"
        data-testid="monday-calendar-bar"
        data-selected={selected ? 'true' : undefined}
        onClick={() => selectMondayItem(item.id)}
        style={{ ...gridColumn(slot), ...mondayStatusSurfaceStyle(item) }}
        className={cn(
          'relative mx-0.5 flex h-6 min-w-0 items-center overflow-hidden rounded-sm border-l-[3px] px-1.5 text-left text-xs text-foreground outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring',
          slot.continuesBefore && 'rounded-l-none border-l-0',
          slot.continuesAfter && 'rounded-r-none',
          selected && 'ring-2 ring-ring',
          flagAtEnd && 'pr-5'
        )}
      >
        {overrun !== null ? (
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 bg-destructive/20"
            style={{ left: `${overrun}%` }}
          />
        ) : null}
        <span
          className={cn(
            'relative truncate',
            item.status?.isDone && 'text-muted-foreground line-through',
            schedule.overdue && 'text-destructive'
          )}
        >
          {item.name}
        </span>
        {slot.dueCol !== null ? (
          <span
            className="absolute inset-y-0 flex items-center"
            style={{ left: `calc(${((slot.dueCol - slot.startCol + 1) / columns) * 100}% - 16px)` }}
          >
            <MondayDueFlag attention={mondayDueNeedsAttention(schedule)} />
          </span>
        ) : null}
      </button>
    </MondayItemHoverSummary>
  )
}

function FlagSlot({
  slot,
  today,
  selected
}: {
  slot: MondayWeekSlot
  today: string
  selected: boolean
}): React.JSX.Element {
  const { item, schedule } = slot.entry
  return (
    <MondayItemHoverSummary entry={slot.entry} today={today}>
      <button
        type="button"
        data-testid="monday-calendar-flag"
        data-selected={selected ? 'true' : undefined}
        onClick={() => selectMondayItem(item.id)}
        style={gridColumn(slot)}
        className={cn(
          'mx-0.5 flex h-6 min-w-0 items-center gap-1 rounded-sm border border-dashed border-border px-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
          selected && 'ring-2 ring-ring'
        )}
      >
        <MondayDueFlag attention={mondayDueNeedsAttention(schedule)} />
        <span
          className={cn('truncate', item.status?.isDone && 'text-muted-foreground line-through')}
        >
          {item.name}
        </span>
      </button>
    </MondayItemHoverSummary>
  )
}

function DayHeader({
  day,
  grid,
  today
}: {
  day: number
  grid: MondayMonthGrid
  today: string
}): React.JSX.Element {
  const iso = fromDayNumber(day)
  const isToday = iso === today
  const inMonth = day >= grid.monthFirstDay && day <= grid.monthLastDay
  return (
    <div className="flex items-center gap-1 px-1.5 pt-1 text-xs">
      <span
        className={cn(
          'flex h-5 min-w-5 items-center justify-center rounded-full px-1 tabular-nums',
          isToday && 'bg-primary font-semibold text-primary-foreground',
          !isToday && !inMonth && 'text-muted-foreground/60'
        )}
      >
        {Number(iso.slice(8, 10))}
      </span>
      {iso.endsWith('-01') ? (
        <span className="text-muted-foreground">{formatMondayShortMonth(day)}</span>
      ) : null}
    </div>
  )
}

function WeekRow(props: {
  weekStart: number
  grid: MondayMonthGrid
  entries: readonly MondayCalendarEntry[]
  today: string
  selectedItemId: string | null
}): React.JSX.Element {
  const { weekStart, grid, entries, today, selectedItemId } = props
  const lanes = useMemo(() => layoutMondayWeek(weekStart, entries), [weekStart, entries])
  const days = Array.from({ length: 7 }, (_, index) => weekStart + index)
  return (
    <div className="relative min-h-28 border-b border-border">
      <div aria-hidden className="absolute inset-0 grid grid-cols-7">
        {days.map((day, index) => (
          <div
            key={day}
            className={cn(
              'border-r border-border last:border-r-0',
              (day < grid.monthFirstDay || day > grid.monthLastDay || index >= 5) && 'bg-muted/30'
            )}
          />
        ))}
      </div>
      <div className="relative grid grid-cols-7">
        {days.map((day) => (
          <DayHeader key={day} day={day} grid={grid} today={today} />
        ))}
      </div>
      <div className="relative space-y-1 py-1.5">
        {lanes.map((lane, laneIndex) => (
          <div key={laneIndex} className="grid grid-cols-7">
            {lane.map((slot) =>
              slot.kind === 'bar' ? (
                <BarSlot
                  key={`bar-${slot.entry.item.id}`}
                  slot={slot}
                  weekStart={weekStart}
                  today={today}
                  selected={slot.entry.item.id === selectedItemId}
                />
              ) : (
                <FlagSlot
                  key={`flag-${slot.entry.item.id}`}
                  slot={slot}
                  today={today}
                  selected={slot.entry.item.id === selectedItemId}
                />
              )
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function MondayMonthView({
  entries,
  anchorMonth,
  today,
  selectedItemId
}: MonthViewProps): React.JSX.Element {
  const grid = useMemo(() => buildMonthGrid(anchorMonth), [anchorMonth])
  const weekdays = useMemo(() => mondayWeekdayNames('short'), [])
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="monday-month-view">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {weekdays.map((name) => (
          <div
            key={name}
            className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {name}
          </div>
        ))}
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        {grid.weekStarts.map((weekStart) => (
          <WeekRow
            key={weekStart}
            weekStart={weekStart}
            grid={grid}
            entries={entries}
            today={today}
            selectedItemId={selectedItemId}
          />
        ))}
      </div>
    </div>
  )
}
