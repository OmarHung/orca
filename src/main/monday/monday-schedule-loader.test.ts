import { describe, expect, it } from 'vitest'
import { MAX_ITEMS_PER_BOARD, MondayScheduleLoader } from './monday-schedule-loader'
import { createFakeMondayGraphql } from './monday-graphql-test-harness'
import type { RawScheduleItem } from './monday-mappers'

const PROJECT_CASES_COLUMNS = [
  { id: 'name', title: 'Name', type: 'name' },
  { id: 'person', title: 'Owner', type: 'people' },
  { id: 'date5', title: 'Due Date', type: 'date' },
  { id: 'status8', title: 'Status', type: 'status' },
  { id: 'timeline', title: 'Timeline', type: 'timeline' }
]

function rawItem(id: string): RawScheduleItem {
  return {
    id,
    name: `Item ${id}`,
    url: `https://autrontech.monday.com/boards/382737576/pulses/${id}`,
    group: { title: '2026年10月維運項目', color: '#00c875' },
    column_values: [
      { id: 'person', type: 'people', text: 'Omar' },
      { id: 'date5', type: 'date', text: '2026-10-01', date: '2026-10-01' },
      {
        id: 'status8',
        type: 'status',
        text: 'Done',
        label: 'Done',
        is_done: true,
        label_style: { color: '#00c875' }
      },
      {
        id: 'timeline',
        type: 'timeline',
        text: '2026-09-30 - 2026-10-01',
        from: '2026-09-30T00:00:00+00:00',
        to: '2026-10-01T00:00:00+00:00'
      }
    ]
  }
}

function fakeGraphql(pages: { cursor: string | null; items: RawScheduleItem[] }[]) {
  let page = 0
  return createFakeMondayGraphql((query) => {
    if (query.includes('columns { id title type }')) {
      return {
        boards: [{ id: '382737576', name: 'Project Cases', columns: PROJECT_CASES_COLUMNS }]
      }
    }
    const current = pages[page]
    page += 1
    return query.includes('next_items_page')
      ? { next_items_page: current }
      : { b0: [{ updated_at: '2026-10-05T09:04:03Z', items_page: current }] }
  })
}

describe('MondayScheduleLoader', () => {
  it('maps items with the detected columns and filters to my items', async () => {
    const graphql = fakeGraphql([{ cursor: null, items: [rawItem('13123057182')] }])
    const loader = new MondayScheduleLoader(
      (query, variables) => graphql.call('token', query, variables),
      () => 42
    )
    const schedule = await loader.load({
      boardIds: ['382737576'],
      personId: '69175796',
      includeUnassigned: true,
      refresh: false
    })

    expect(schedule.fetchedAt).toBe(42)
    expect(schedule.boards[0].updatedAt).toBe('2026-10-05T09:04:03Z')
    expect(schedule.boards).toHaveLength(1)
    const [board] = schedule.boards
    expect(board.roleTitles).toMatchObject({
      timelineColumnId: 'Timeline',
      dueDateColumnId: 'Due Date'
    })
    expect(board.items[0]).toMatchObject({
      id: '13123057182',
      timeline: { from: '2026-09-30', to: '2026-10-01' },
      dueDate: '2026-10-01',
      status: { label: 'Done', color: '#00c875', isDone: true },
      peopleText: 'Omar'
    })
    const firstPageVariables = graphql.mock.mock.calls[1][2]
    expect(firstPageVariables.c0).toEqual(['status8', 'person', 'timeline', 'date5'])
    expect(firstPageVariables.q0).toEqual({
      operator: 'or',
      rules: [
        { column_id: 'person', compare_value: ['person-69175796'], operator: 'any_of' },
        { column_id: 'person', compare_value: [], operator: 'is_empty' }
      ]
    })
  })

  it('filters to one person without unassigned items when asked', async () => {
    const graphql = fakeGraphql([{ cursor: null, items: [] }])
    const loader = new MondayScheduleLoader((query, variables) =>
      graphql.call('token', query, variables)
    )
    await loader.load({
      boardIds: ['382737576'],
      personId: '63803784',
      includeUnassigned: false,
      refresh: false
    })
    expect(graphql.mock.mock.calls[1][2].q0).toEqual({
      rules: [{ column_id: 'person', compare_value: ['person-63803784'], operator: 'any_of' }]
    })
  })

  it('reuses board columns until a refresh', async () => {
    const graphql = fakeGraphql([
      { cursor: null, items: [] },
      { cursor: null, items: [] },
      { cursor: null, items: [] }
    ])
    const loader = new MondayScheduleLoader((query, variables) =>
      graphql.call('token', query, variables)
    )
    await loader.load({
      boardIds: ['382737576'],
      personId: null,
      includeUnassigned: true,
      refresh: false
    })
    await loader.load({
      boardIds: ['382737576'],
      personId: null,
      includeUnassigned: true,
      refresh: false
    })
    expect(graphql.mock).toHaveBeenCalledTimes(3)
    await loader.load({
      boardIds: ['382737576'],
      personId: null,
      includeUnassigned: true,
      refresh: true
    })
    expect(graphql.mock).toHaveBeenCalledTimes(5)
    expect(graphql.mock.mock.calls[2][2].q0).toBeNull()
  })

  it('follows cursors and stops at the per-board cap', async () => {
    const page = (start: number): RawScheduleItem[] =>
      Array.from({ length: 500 }, (_, index) => rawItem(String(start + index)))
    const graphql = fakeGraphql([
      { cursor: 'c1', items: page(0) },
      { cursor: 'c2', items: page(500) },
      { cursor: 'c3', items: page(1000) },
      { cursor: 'c4', items: page(1500) }
    ])
    const loader = new MondayScheduleLoader((query, variables) =>
      graphql.call('token', query, variables)
    )
    const schedule = await loader.load({
      boardIds: ['382737576'],
      personId: null,
      includeUnassigned: true,
      refresh: false
    })
    expect(schedule.boards[0].items).toHaveLength(MAX_ITEMS_PER_BOARD)
    expect(schedule.boards[0].truncated).toBe(true)
  })

  it('skips boards monday no longer returns', async () => {
    const graphql = createFakeMondayGraphql(() => ({ boards: [] }))
    const loader = new MondayScheduleLoader((query, variables) =>
      graphql.call('token', query, variables)
    )
    const schedule = await loader.load({
      boardIds: ['1'],
      personId: '69175796',
      includeUnassigned: true,
      refresh: false
    })
    expect(schedule.boards).toEqual([])
    expect(graphql.mock).toHaveBeenCalledTimes(1)
  })
})
