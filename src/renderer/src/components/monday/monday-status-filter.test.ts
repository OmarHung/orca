import { describe, expect, it } from 'vitest'
import type {
  MondayBoardSchedule,
  MondaySchedule,
  MondayScheduleItem
} from '../../../../shared/monday/monday-types'
import {
  collectMondayStatusOptions,
  matchesMondayStatusFilter,
  MONDAY_NO_STATUS
} from './monday-status-filter'

const ROLES = {
  statusColumnId: null,
  priorityColumnId: null,
  peopleColumnId: null,
  timelineColumnId: null,
  startDateColumnId: null,
  dueDateColumnId: null
}

const STUCK = { label: 'Stuck', color: '#df2f4a', isDone: false }
const IN_PROGRESS = { label: 'In Progress', color: '#fdab3d', isDone: false }
const DONE = { label: 'Done', color: '#00c875', isDone: true }

function item(id: string, status: MondayScheduleItem['status']): MondayScheduleItem {
  return {
    id,
    boardId: 'b1',
    name: `Item ${id}`,
    url: '',
    groupTitle: '',
    groupColor: null,
    status,
    priority: null,
    peopleText: '',
    timeline: null,
    startDate: null,
    dueDate: null
  }
}

function board(boardId: string, items: MondayScheduleItem[]): MondayBoardSchedule {
  return {
    boardId,
    boardName: boardId,
    roles: ROLES,
    roleTitles: {},
    items,
    truncated: false,
    updatedAt: null
  }
}

const SCHEDULE: MondaySchedule = {
  fetchedAt: 0,
  boards: [
    board('b1', [item('1', STUCK), item('2', DONE), item('3', null)]),
    board('b2', [item('4', STUCK), item('5', IN_PROGRESS)])
  ]
}

describe('collectMondayStatusOptions', () => {
  it('merges labels across boards: open first, then done, then no status', () => {
    expect(
      collectMondayStatusOptions(SCHEDULE, false, []).map(({ key, count }) => [key, count])
    ).toEqual([
      ['In Progress', 1],
      ['Stuck', 2],
      ['Done', 1],
      [MONDAY_NO_STATUS, 1]
    ])
  })

  it('leaves out done statuses while done items are hidden', () => {
    expect(
      collectMondayStatusOptions(SCHEDULE, true, []).map((option) => option.key)
    ).not.toContain('Done')
  })

  it('keeps a selected status these boards lack, so it can be cleared', () => {
    expect(collectMondayStatusOptions(SCHEDULE, false, ['Waiting'])).toContainEqual({
      key: 'Waiting',
      color: null,
      isDone: false,
      count: 0
    })
  })
})

describe('matchesMondayStatusFilter', () => {
  it('shows everything with no statuses selected', () => {
    expect(matchesMondayStatusFilter(item('1', null), [])).toBe(true)
  })

  it('matches by label, with no status as its own choice', () => {
    expect(matchesMondayStatusFilter(item('1', STUCK), ['Stuck'])).toBe(true)
    expect(matchesMondayStatusFilter(item('1', DONE), ['Stuck'])).toBe(false)
    expect(matchesMondayStatusFilter(item('1', null), ['Stuck'])).toBe(false)
    expect(matchesMondayStatusFilter(item('1', null), [MONDAY_NO_STATUS])).toBe(true)
  })
})
