import { mondayScheduleTouches, toDayNumber } from '../../../../shared/monday/monday-schedule'
import { entryStartDay, type MondayCalendarEntry } from './monday-calendar-model'

export type MondayGanttBar = {
  startCol: number
  endCol: number
  /** The bar starts before / ends after the visible range. */
  clippedStart: boolean
  clippedEnd: boolean
}

export type MondayGanttRow = {
  entry: MondayCalendarEntry
  bar: MondayGanttBar | null
  dueCol: number | null
}

export type MondayGanttGroup = { boardId: string; boardName: string; rows: MondayGanttRow[] }

function ganttBar(
  entry: MondayCalendarEntry,
  firstDay: number,
  lastDay: number
): MondayGanttBar | null {
  const span = entry.schedule.span
  if (!span) {
    return null
  }
  const from = toDayNumber(span.from)
  const to = toDayNumber(span.to)
  if (from > lastDay || to < firstDay) {
    return null
  }
  return {
    startCol: Math.max(from, firstDay) - firstDay,
    endCol: Math.min(to, lastDay) - firstDay,
    clippedStart: from < firstDay,
    clippedEnd: to > lastDay
  }
}

function dueColumn(entry: MondayCalendarEntry, firstDay: number, lastDay: number): number | null {
  const due = entry.schedule.due ? toDayNumber(entry.schedule.due) : null
  return due !== null && due >= firstDay && due <= lastDay ? due - firstDay : null
}

/** One row per item touching [firstDay, lastDay], grouped by board and sorted by start. */
export function buildMondayGantt(
  entries: readonly MondayCalendarEntry[],
  boardOrder: readonly string[],
  firstDay: number,
  lastDay: number
): MondayGanttGroup[] {
  const groups = new Map<string, MondayGanttGroup>()
  const visible = entries
    .filter((entry) => mondayScheduleTouches(entry.schedule, firstDay, lastDay))
    .sort((a, b) => entryStartDay(a) - entryStartDay(b) || a.item.name.localeCompare(b.item.name))
  for (const entry of visible) {
    const boardId = entry.item.boardId
    const group = groups.get(boardId) ?? { boardId, boardName: entry.boardName, rows: [] }
    group.rows.push({
      entry,
      bar: ganttBar(entry, firstDay, lastDay),
      dueCol: dueColumn(entry, firstDay, lastDay)
    })
    groups.set(boardId, group)
  }
  return [...groups.values()].sort(
    (a, b) => boardOrder.indexOf(a.boardId) - boardOrder.indexOf(b.boardId)
  )
}
