import { describe, expect, it } from 'vitest'
import {
  computeMondayItemSchedule,
  fromDayNumber,
  localIsoDate,
  mondayScheduleTouches,
  normalizeMondayDate,
  toDayNumber
} from './monday-schedule'
import type { MondayScheduleItem } from './monday-types'

function item(overrides: Partial<MondayScheduleItem>): MondayScheduleItem {
  return {
    id: '1',
    boardId: '9',
    name: 'Task',
    url: 'https://example.monday.com/boards/9/pulses/1',
    groupTitle: 'Group',
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

const TODAY = '2026-10-05'

describe('day numbers', () => {
  it('round-trips dates across a DST change', () => {
    expect(fromDayNumber(toDayNumber('2026-03-29'))).toBe('2026-03-29')
    expect(toDayNumber('2026-03-30') - toDayNumber('2026-03-29')).toBe(1)
  })

  it('rejects malformed dates', () => {
    expect(toDayNumber('2026/10/05')).toBeNaN()
    expect(normalizeMondayDate('')).toBeNull()
    expect(normalizeMondayDate(null)).toBeNull()
  })

  it('keeps the date part of a monday timeline timestamp', () => {
    expect(normalizeMondayDate('2026-11-13T00:00:00+00:00')).toBe('2026-11-13')
  })

  it('formats the local date', () => {
    expect(localIsoDate(new Date(2026, 0, 2, 23, 30))).toBe('2026-01-02')
  })
})

describe('computeMondayItemSchedule', () => {
  it('draws the timeline and flags a due date inside it', () => {
    const schedule = computeMondayItemSchedule(
      item({ timeline: { from: '2026-10-06', to: '2026-10-10' }, dueDate: '2026-10-08' }),
      TODAY
    )
    expect(schedule.span).toEqual({ from: '2026-10-06', to: '2026-10-10' })
    expect(schedule.spanSource).toBe('timeline')
    expect(schedule.due).toBe('2026-10-08')
    expect(schedule.dueBeforeEnd).toBe(true)
    expect(schedule.overdue).toBe(false)
  })

  it('builds the bar from start date to due date when there is no timeline', () => {
    const schedule = computeMondayItemSchedule(
      item({ startDate: '2026-10-01', dueDate: '2026-10-09' }),
      TODAY
    )
    expect(schedule.span).toEqual({ from: '2026-10-01', to: '2026-10-09' })
    expect(schedule.spanSource).toBe('start-due')
    expect(schedule.dueBeforeEnd).toBe(false)
  })

  it('keeps a start date after the due date as a one-day bar and warns', () => {
    const schedule = computeMondayItemSchedule(
      item({ startDate: '2026-10-12', dueDate: '2026-10-09' }),
      TODAY
    )
    expect(schedule.span).toEqual({ from: '2026-10-12', to: '2026-10-12' })
    expect(schedule.dueBeforeEnd).toBe(true)
  })

  it('swaps a reversed timeline', () => {
    const schedule = computeMondayItemSchedule(
      item({ timeline: { from: '2026-10-10', to: '2026-10-06' } }),
      TODAY
    )
    expect(schedule.span).toEqual({ from: '2026-10-06', to: '2026-10-10' })
  })

  it('marks open work past its due date as overdue, but not done work', () => {
    const late = item({ dueDate: '2026-10-01' })
    expect(computeMondayItemSchedule(late, TODAY).overdue).toBe(true)
    const done = item({
      dueDate: '2026-10-01',
      status: { label: 'Done', color: '#00c875', isDone: true }
    })
    expect(computeMondayItemSchedule(done, TODAY).overdue).toBe(false)
  })

  it('falls back to the bar end for overdue when there is no due date', () => {
    const schedule = computeMondayItemSchedule(
      item({ timeline: { from: '2026-09-01', to: '2026-09-30' } }),
      TODAY
    )
    expect(schedule.overdue).toBe(true)
    expect(schedule.due).toBeNull()
  })
})

describe('mondayScheduleTouches', () => {
  const first = toDayNumber('2026-10-05')
  const last = toDayNumber('2026-10-11')

  it('matches a bar overlapping the window', () => {
    const schedule = computeMondayItemSchedule(
      item({ timeline: { from: '2026-09-28', to: '2026-10-05' } }),
      TODAY
    )
    expect(mondayScheduleTouches(schedule, first, last)).toBe(true)
  })

  it('matches a due date inside the window even when the bar is outside', () => {
    const schedule = computeMondayItemSchedule(
      item({ timeline: { from: '2026-09-01', to: '2026-09-03' }, dueDate: '2026-10-07' }),
      TODAY
    )
    expect(mondayScheduleTouches(schedule, first, last)).toBe(true)
  })

  it('skips work entirely outside the window', () => {
    const schedule = computeMondayItemSchedule(item({ dueDate: '2026-10-20' }), TODAY)
    expect(mondayScheduleTouches(schedule, first, last)).toBe(false)
  })
})
