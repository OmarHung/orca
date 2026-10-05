import { describe, expect, it } from 'vitest'
import { detectMondayColumnRoles, mondayRoleColumnIds } from './monday-column-roles'

// Column lists as read from the user's real boards (2026-10-05).
const OMARS_TASK = [
  { id: 'name', title: 'Name', type: 'name' },
  { id: '___8', title: '子項目', type: 'subtasks' },
  { id: 'multiple_person_mkq95a24', title: '使用者', type: 'people' },
  { id: 'date__1', title: '開始日期', type: 'date' },
  { id: 'date4', title: 'Due Date', type: 'date' },
  { id: 'numeric__1', title: '預計工時', type: 'numbers' },
  { id: 'status', title: 'Status', type: 'status' },
  { id: 'status_1', title: 'Priority', type: 'status' }
]

const PROJECT_CASES = [
  { id: 'name', title: 'Name', type: 'name' },
  { id: 'person', title: 'Owner', type: 'people' },
  { id: 'date5', title: 'Due Date', type: 'date' },
  { id: 'status8', title: 'Status', type: 'status' },
  { id: 'timeline', title: 'Timeline', type: 'timeline' },
  { id: 'status0', title: 'Priority', type: 'status' }
]

describe('detectMondayColumnRoles', () => {
  it('maps a board with start and due date columns', () => {
    expect(detectMondayColumnRoles(OMARS_TASK)).toEqual({
      statusColumnId: 'status',
      priorityColumnId: 'status_1',
      peopleColumnId: 'multiple_person_mkq95a24',
      timelineColumnId: null,
      startDateColumnId: 'date__1',
      dueDateColumnId: 'date4'
    })
  })

  it('maps a board with a timeline and a due date', () => {
    expect(detectMondayColumnRoles(PROJECT_CASES)).toEqual({
      statusColumnId: 'status8',
      priorityColumnId: 'status0',
      peopleColumnId: 'person',
      timelineColumnId: 'timeline',
      startDateColumnId: null,
      dueDateColumnId: 'date5'
    })
  })

  it('treats a lone date column as the due date', () => {
    const roles = detectMondayColumnRoles([{ id: 'date', title: 'Date', type: 'date' }])
    expect(roles.dueDateColumnId).toBe('date')
    expect(roles.startDateColumnId).toBeNull()
  })

  it('never picks the priority column as the status', () => {
    const roles = detectMondayColumnRoles([
      { id: 'p', title: 'Priority', type: 'status' },
      { id: 's', title: 'Stage', type: 'status' }
    ])
    expect(roles.statusColumnId).toBe('s')
    expect(roles.priorityColumnId).toBe('p')
  })

  it('lists only the columns that were found', () => {
    expect(mondayRoleColumnIds(detectMondayColumnRoles(PROJECT_CASES))).toEqual([
      'status8',
      'status0',
      'person',
      'timeline',
      'date5'
    ])
  })
})
