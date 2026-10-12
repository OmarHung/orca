import {
  computeMondayItemSchedule,
  fromDayNumber,
  hasMondaySchedule,
  toDayNumber,
  type MondayItemSchedule
} from '../../../../shared/monday/monday-schedule'
import type { MondaySchedule, MondayScheduleItem } from '../../../../shared/monday/monday-types'
import { matchesMondayStatusFilter } from './monday-status-filter'
import { TAIWAN_PUBLIC_HOLIDAYS } from './taiwan-public-holidays'

export type MondayCalendarEntry = {
  item: MondayScheduleItem
  boardName: string
  schedule: MondayItemSchedule
}

export type MondayEntryFilters = { hideDone: boolean; statusLabels: readonly string[] }

export function buildMondayEntries(
  schedule: MondaySchedule,
  filters: MondayEntryFilters,
  today: string
): { scheduled: MondayCalendarEntry[]; unscheduled: MondayCalendarEntry[] } {
  const scheduled: MondayCalendarEntry[] = []
  const unscheduled: MondayCalendarEntry[] = []
  for (const board of schedule.boards) {
    for (const item of board.items) {
      if (
        (filters.hideDone && item.status?.isDone) ||
        !matchesMondayStatusFilter(item, filters.statusLabels)
      ) {
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

export type MondayUndatedGroup = {
  boardId: string
  boardName: string
  entries: MondayCalendarEntry[]
}

/** Undated items by board in picker order; monday's own order within a board, done work last. */
export function groupMondayUndatedEntries(
  entries: readonly MondayCalendarEntry[],
  boardOrder: readonly string[]
): MondayUndatedGroup[] {
  const groups = new Map<string, MondayUndatedGroup>()
  for (const entry of entries) {
    const boardId = entry.item.boardId
    const group = groups.get(boardId) ?? { boardId, boardName: entry.boardName, entries: [] }
    group.entries.push(entry)
    groups.set(boardId, group)
  }
  return [...groups.values()]
    .sort((a, b) => boardOrder.indexOf(a.boardId) - boardOrder.indexOf(b.boardId))
    .map((group) => ({
      ...group,
      entries: group.entries.toSorted(
        (a, b) => Number(a.item.status?.isDone === true) - Number(b.item.status?.isDone === true)
      )
    }))
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

/** Sunday = 0 … Saturday = 6. Day 0 (1970-01-01) was a Thursday. */
export function mondayWeekdayIndex(day: number): number {
  return (((day + 4) % 7) + 7) % 7
}

export function isWeekendDay(day: number): boolean {
  const index = mondayWeekdayIndex(day)
  return index === 0 || index === 6
}

export function publicHolidayName(day: number): string | null {
  return TAIWAN_PUBLIC_HOLIDAYS[fromDayNumber(day)] ?? null
}

export type MondayMonthGrid = {
  /** Day number of each week's Sunday. */
  weekStarts: number[]
  firstDay: number
  lastDay: number
  monthFirstDay: number
  monthLastDay: number
}

/** Whole Sunday-to-Saturday weeks covering the anchor month. */
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
