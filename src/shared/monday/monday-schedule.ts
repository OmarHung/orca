import type { MondayDateRange, MondayScheduleItem } from './monday-types'

const DAY_MS = 86_400_000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Days since the Unix epoch for a `YYYY-MM-DD` date; UTC so DST never shifts a day. */
export function toDayNumber(isoDate: string): number {
  const match = ISO_DATE.exec(isoDate)
  if (!match) {
    return Number.NaN
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS
}

export function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** The viewer's local calendar date. */
export function localIsoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** Accepts `YYYY-MM-DD` or an ISO timestamp (monday's TimelineValue) and keeps the date part. */
export function normalizeMondayDate(value: string | null | undefined): string | null {
  const date = value?.slice(0, 10) ?? ''
  return Number.isNaN(toDayNumber(date)) ? null : date
}

export type MondaySpanSource = 'timeline' | 'start-due' | 'start'

export type MondayItemSchedule = {
  /** The bar: the timeline column, else start date → due date. */
  span: MondayDateRange | null
  spanSource: MondaySpanSource | null
  /** The flag. */
  due: string | null
  /** Not done and past its due date (or past the bar's end when there is no due date). */
  overdue: boolean
  /** Due earlier than the bar ends: the plan runs past its own deadline. */
  dueBeforeEnd: boolean
}

function pickSpan(item: MondayScheduleItem): {
  span: MondayDateRange | null
  spanSource: MondaySpanSource | null
} {
  if (item.timeline) {
    const ordered = item.timeline.from <= item.timeline.to
    return {
      span: ordered ? item.timeline : { from: item.timeline.to, to: item.timeline.from },
      spanSource: 'timeline'
    }
  }
  if (item.startDate && item.dueDate && item.startDate <= item.dueDate) {
    return { span: { from: item.startDate, to: item.dueDate }, spanSource: 'start-due' }
  }
  if (item.startDate) {
    return { span: { from: item.startDate, to: item.startDate }, spanSource: 'start' }
  }
  return { span: null, spanSource: null }
}

export function computeMondayItemSchedule(
  item: MondayScheduleItem,
  today: string
): MondayItemSchedule {
  const { span, spanSource } = pickSpan(item)
  const due = item.dueDate
  const deadline = due ?? span?.to ?? null
  const isDone = item.status?.isDone === true
  return {
    span,
    spanSource,
    due,
    overdue: !isDone && deadline !== null && deadline < today,
    dueBeforeEnd: due !== null && span !== null && due < span.to
  }
}

export function hasMondaySchedule(schedule: MondayItemSchedule): boolean {
  return schedule.span !== null || schedule.due !== null
}

/** Whether the bar or the flag falls inside [firstDay, lastDay] (day numbers, inclusive). */
export function mondayScheduleTouches(
  schedule: MondayItemSchedule,
  firstDay: number,
  lastDay: number
): boolean {
  if (schedule.span) {
    const from = toDayNumber(schedule.span.from)
    const to = toDayNumber(schedule.span.to)
    if (from <= lastDay && to >= firstDay) {
      return true
    }
  }
  if (schedule.due) {
    const due = toDayNumber(schedule.due)
    return due >= firstDay && due <= lastDay
  }
  return false
}
