import { describe, expect, it } from 'vitest'
import { fromDayNumber, toDayNumber } from '../../../../shared/monday/monday-schedule'
import type { MondaySchedule, MondayScheduleItem } from '../../../../shared/monday/monday-types'
import {
  buildMondayEntries,
  buildMonthGrid,
  mondayWeekdayIndex,
  shiftMonth,
  type MondayCalendarEntry
} from './monday-calendar-model'
import { buildMondayGantt } from './monday-gantt-model'
import { layoutMondayWeek } from './monday-week-layout'

const TODAY = '2026-10-05'
const ROLES = {
  statusColumnId: null,
  priorityColumnId: null,
  peopleColumnId: null,
  timelineColumnId: null,
  startDateColumnId: null,
  dueDateColumnId: null
}

function item(id: string, overrides: Partial<MondayScheduleItem>): MondayScheduleItem {
  return {
    id,
    boardId: 'b1',
    name: `Item ${id}`,
    url: '',
    groupTitle: '',
    groupColor: null,
    status: null,
    priority: null,
    peopleText: '',
    timeline: null,
    startDate: null,
    dueDate: null,
    ...overrides
  }
}

function entries(items: MondayScheduleItem[], hideDone = false): MondayCalendarEntry[] {
  const schedule: MondaySchedule = {
    fetchedAt: 0,
    boards: [
      { boardId: 'b1', boardName: 'Board', roles: ROLES, roleTitles: {}, items, truncated: false }
    ]
  }
  return buildMondayEntries(schedule, hideDone, TODAY).scheduled
}

describe('month grid', () => {
  it('covers October 2026 with Monday-start weeks', () => {
    const grid = buildMonthGrid('2026-10-01')
    expect(fromDayNumber(grid.firstDay)).toBe('2026-09-28')
    expect(fromDayNumber(grid.lastDay)).toBe('2026-11-01')
    expect(grid.weekStarts).toHaveLength(5)
    expect(grid.weekStarts.every((day) => mondayWeekdayIndex(day) === 0)).toBe(true)
  })

  it('shifts across year boundaries', () => {
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01')
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01')
  })
})

describe('buildMondayEntries', () => {
  it('splits undated items and can hide done work', () => {
    const items = [
      item('1', { dueDate: '2026-10-06' }),
      item('2', {}),
      item('3', { dueDate: '2026-10-07', status: { label: 'Done', color: '#0f0', isDone: true } })
    ]
    const schedule: MondaySchedule = {
      fetchedAt: 0,
      boards: [
        { boardId: 'b1', boardName: 'Board', roles: ROLES, roleTitles: {}, items, truncated: false }
      ]
    }
    const all = buildMondayEntries(schedule, false, TODAY)
    expect(all.scheduled.map((entry) => entry.item.id)).toEqual(['1', '3'])
    expect(all.unscheduled.map((entry) => entry.item.id)).toEqual(['2'])
    expect(
      buildMondayEntries(schedule, true, TODAY).scheduled.map((entry) => entry.item.id)
    ).toEqual(['1'])
  })
})

describe('layoutMondayWeek', () => {
  const week = toDayNumber('2026-10-05')

  it('draws the due flag on the bar when the bar covers it', () => {
    const lanes = layoutMondayWeek(
      week,
      entries([
        item('1', { timeline: { from: '2026-10-06', to: '2026-10-09' }, dueDate: '2026-10-08' })
      ])
    )
    expect(lanes).toHaveLength(1)
    expect(lanes[0][0]).toMatchObject({ kind: 'bar', startCol: 1, endCol: 4, dueCol: 3 })
  })

  it('adds a separate flag when the due date is outside the bar', () => {
    const lanes = layoutMondayWeek(
      week,
      entries([
        item('1', { timeline: { from: '2026-10-05', to: '2026-10-06' }, dueDate: '2026-10-09' })
      ])
    )
    expect(lanes.flat().map((slot) => [slot.kind, slot.startCol])).toEqual([
      ['bar', 0],
      ['flag', 4]
    ])
  })

  it('clips bars at the week edges', () => {
    const lanes = layoutMondayWeek(
      week,
      entries([item('1', { timeline: { from: '2026-10-01', to: '2026-10-20' } })])
    )
    expect(lanes[0][0]).toMatchObject({
      startCol: 0,
      endCol: 6,
      continuesBefore: true,
      continuesAfter: true,
      dueCol: null
    })
  })

  it('stacks overlapping work in lanes and reuses free lanes', () => {
    const lanes = layoutMondayWeek(
      week,
      entries([
        item('long', { timeline: { from: '2026-10-05', to: '2026-10-08' } }),
        item('overlap', { timeline: { from: '2026-10-06', to: '2026-10-07' } }),
        item('later', { dueDate: '2026-10-10' })
      ])
    )
    expect(lanes.map((lane) => lane.map((slot) => slot.entry.item.id))).toEqual([
      ['long', 'later'],
      ['overlap']
    ])
  })

  it('ignores work in other weeks', () => {
    expect(layoutMondayWeek(week, entries([item('1', { dueDate: '2026-10-20' })]))).toEqual([])
  })
})

describe('buildMondayGantt', () => {
  const first = toDayNumber('2026-09-28')
  const last = toDayNumber('2026-11-01')

  it('groups rows by board in picker order and sorts by start', () => {
    const groups = buildMondayGantt(
      [
        ...entries([
          item('late', { dueDate: '2026-10-20' }),
          item('early', { startDate: '2026-10-02', dueDate: '2026-10-09' })
        ]),
        ...entries([item('other', { boardId: 'b2', dueDate: '2026-10-03' })])
      ],
      ['b2', 'b1'],
      first,
      last
    )
    expect(groups.map((group) => group.boardId)).toEqual(['b2', 'b1'])
    expect(groups[1].rows.map((row) => row.entry.item.id)).toEqual(['early', 'late'])
    expect(groups[1].rows[0]).toMatchObject({
      bar: { startCol: 4, endCol: 11, clippedStart: false, clippedEnd: false },
      dueCol: 11
    })
    expect(groups[1].rows[1]).toMatchObject({ bar: null, dueCol: 22 })
  })

  it('clips bars to the visible range', () => {
    const [group] = buildMondayGantt(
      entries([item('1', { timeline: { from: '2026-09-01', to: '2026-12-31' } })]),
      ['b1'],
      first,
      last
    )
    expect(group.rows[0].bar).toEqual({
      startCol: 0,
      endCol: last - first,
      clippedStart: true,
      clippedEnd: true
    })
  })
})
