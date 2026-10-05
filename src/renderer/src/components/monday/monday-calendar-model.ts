import {
  computeMondayItemSchedule,
  hasMondaySchedule,
  toDayNumber,
  type MondayItemSchedule
} from '../../../../shared/monday/monday-schedule'
import type { MondaySchedule, MondayScheduleItem } from '../../../../shared/monday/monday-types'

export type MondayCalendarEntry = {
  item: MondayScheduleItem
  boardName: string
  schedule: MondayItemSchedule
}

export function buildMondayEntries(
  schedule: MondaySchedule,
  hideDone: boolean,
  today: string
): { scheduled: MondayCalendarEntry[]; unscheduled: MondayCalendarEntry[] } {
  const scheduled: MondayCalendarEntry[] = []
  const unscheduled: MondayCalendarEntry[] = []
  for (const board of schedule.boards) {
    for (const item of board.items) {
      if (hideDone && item.status?.isDone) {
        continue
      }
      const entry = {
        item,
        boardName: board.boardName,
        schedule: computeMondayItemSchedule(item, today)
      }
      if (hasMondaySchedule(entry.schedule)) {
        scheduled.push(entry)
      } else {
        unscheduled.push(entry)
      }
    }
  }
  return { scheduled, unscheduled }
}

/** First of the month, `YYYY-MM-01`. */
export function monthOf(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`
}

export function shiftMonth(anchorMonth: string, delta: number): string {
  const year = Number(anchorMonth.slice(0, 4))
  const month = Number(anchorMonth.slice(5, 7)) - 1 + delta
  const date = new Date(Date.UTC(year, month, 1))
  return date.toISOString().slice(0, 10)
}

/** Monday = 0 … Sunday = 6. Day 0 (1970-01-01) was a Thursday. */
export function mondayWeekdayIndex(day: number): number {
  return (((day + 3) % 7) + 7) % 7
}

export type MondayMonthGrid = {
  /** Day number of each week's Monday. */
  weekStarts: number[]
  firstDay: number
  lastDay: number
  monthFirstDay: number
  monthLastDay: number
}

/** Whole Monday-to-Sunday weeks covering the anchor month. */
export function buildMonthGrid(anchorMonth: string): MondayMonthGrid {
  const monthFirstDay = toDayNumber(anchorMonth)
  const monthLastDay = toDayNumber(shiftMonth(anchorMonth, 1)) - 1
  const firstDay = monthFirstDay - mondayWeekdayIndex(monthFirstDay)
  const lastDay = monthLastDay + (6 - mondayWeekdayIndex(monthLastDay))
  const weekStarts: number[] = []
  for (let day = firstDay; day <= lastDay; day += 7) {
    weekStarts.push(day)
  }
  return { weekStarts, firstDay, lastDay, monthFirstDay, monthLastDay }
}

/** Start sort key: bar start, else the due date. */
export function entryStartDay(entry: MondayCalendarEntry): number {
  const { span, due } = entry.schedule
  return toDayNumber(span?.from ?? due ?? '')
}
