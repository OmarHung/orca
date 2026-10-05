import { toDayNumber } from '../../../../shared/monday/monday-schedule'
import type { MondayCalendarEntry } from './monday-calendar-model'

export type MondayWeekBar = {
  kind: 'bar'
  entry: MondayCalendarEntry
  startCol: number
  endCol: number
  continuesBefore: boolean
  continuesAfter: boolean
  /** Column of the due flag when it lands on this piece of the bar. */
  dueCol: number | null
}

/** A due date drawn on its own because no bar covers that day. */
export type MondayWeekFlag = {
  kind: 'flag'
  entry: MondayCalendarEntry
  startCol: number
  endCol: number
}

export type MondayWeekSlot = MondayWeekBar | MondayWeekFlag

function barSlot(
  entry: MondayCalendarEntry,
  weekStart: number,
  from: number,
  to: number,
  dueDay: number | null
): MondayWeekBar | null {
  const weekEnd = weekStart + 6
  if (from > weekEnd || to < weekStart) {
    return null
  }
  const visibleFrom = Math.max(from, weekStart)
  const visibleTo = Math.min(to, weekEnd)
  return {
    kind: 'bar',
    entry,
    startCol: visibleFrom - weekStart,
    endCol: visibleTo - weekStart,
    continuesBefore: from < weekStart,
    continuesAfter: to > weekEnd,
    dueCol:
      dueDay !== null && dueDay >= visibleFrom && dueDay <= visibleTo ? dueDay - weekStart : null
  }
}

function slotsForEntry(entry: MondayCalendarEntry, weekStart: number): MondayWeekSlot[] {
  const { span, due } = entry.schedule
  const dueDay = due ? toDayNumber(due) : null
  const slots: MondayWeekSlot[] = []
  let dueOnBar = false
  if (span) {
    const from = toDayNumber(span.from)
    const to = toDayNumber(span.to)
    const bar = barSlot(entry, weekStart, from, to, dueDay)
    if (bar) {
      slots.push(bar)
    }
    dueOnBar = dueDay !== null && dueDay >= from && dueDay <= to
  }
  if (dueDay !== null && !dueOnBar && dueDay >= weekStart && dueDay <= weekStart + 6) {
    slots.push({ kind: 'flag', entry, startCol: dueDay - weekStart, endCol: dueDay - weekStart })
  }
  return slots
}

/**
 * Packs one week's bars and flags into lanes (rows) so nothing overlaps: longest first within a
 * start column, each slot in the first lane that is free from its start column on.
 */
export function layoutMondayWeek(
  weekStart: number,
  entries: readonly MondayCalendarEntry[]
): MondayWeekSlot[][] {
  const slots = entries.flatMap((entry) => slotsForEntry(entry, weekStart))
  slots.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.endCol - b.startCol - (a.endCol - a.startCol) ||
      a.entry.item.name.localeCompare(b.entry.item.name)
  )
  const lanes: MondayWeekSlot[][] = []
  const laneEnds: number[] = []
  for (const slot of slots) {
    const lane = laneEnds.findIndex((end) => end < slot.startCol)
    if (lane === -1) {
      lanes.push([slot])
      laneEnds.push(slot.endCol)
    } else {
      lanes[lane].push(slot)
      laneEnds[lane] = slot.endCol
    }
  }
  return lanes
}
