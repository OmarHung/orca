import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MondaySchedule } from '../../../../shared/monday/monday-types'

const monday = vi.hoisted(() => {
  const api = { boardsUpdatedAt: vi.fn(), loadSchedule: vi.fn(), getItem: vi.fn() }
  Object.assign(globalThis, { window: { api: { monday: api } } })
  return api
})

import { checkMondayForChanges } from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'

const ROLES = {
  statusColumnId: null,
  priorityColumnId: null,
  peopleColumnId: null,
  timelineColumnId: null,
  startDateColumnId: null,
  dueDateColumnId: null
}

function schedule(updatedAt: string, fetchedAt = 1): MondaySchedule {
  return {
    fetchedAt,
    boards: [
      {
        boardId: '382737576',
        boardName: 'Project Cases',
        roles: ROLES,
        roleTitles: {},
        items: [],
        truncated: false,
        updatedAt
      }
    ]
  }
}

const LONG_AGO = 0

beforeEach(() => {
  monday.boardsUpdatedAt.mockReset()
  monday.loadSchedule.mockReset()
  monday.getItem.mockReset()
  useMondayPageStore.setState({
    connection: { account: null, tokenKeptForSessionOnly: false },
    prefs: { boardIds: ['382737576'], includeUnassigned: true, hideDone: false, view: 'month' },
    schedule: schedule('2026-10-05T09:00:00Z'),
    scheduleLoading: false,
    scheduleError: null,
    syncedAt: LONG_AGO,
    selectedItemId: null,
    details: {}
  })
})

describe('checkMondayForChanges', () => {
  it('only confirms the sync time when no board changed', async () => {
    monday.boardsUpdatedAt.mockResolvedValue({
      ok: true,
      value: { '382737576': '2026-10-05T09:00:00Z' }
    })
    await checkMondayForChanges()
    expect(monday.boardsUpdatedAt).toHaveBeenCalledWith(['382737576'])
    expect(monday.loadSchedule).not.toHaveBeenCalled()
    expect(useMondayPageStore.getState().syncedAt).toBeGreaterThan(LONG_AGO)
  })

  it('re-reads the schedule when a board changed', async () => {
    monday.boardsUpdatedAt.mockResolvedValue({
      ok: true,
      value: { '382737576': '2026-10-05T09:30:00Z' }
    })
    monday.loadSchedule.mockResolvedValue({ ok: true, value: schedule('2026-10-05T09:30:00Z', 2) })
    await checkMondayForChanges()
    expect(monday.loadSchedule).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }))
    expect(useMondayPageStore.getState().schedule?.boards[0].updatedAt).toBe('2026-10-05T09:30:00Z')
  })

  it('skips the check right after a sync', async () => {
    useMondayPageStore.setState({ syncedAt: Date.now() })
    await checkMondayForChanges()
    expect(monday.boardsUpdatedAt).not.toHaveBeenCalled()
  })

  it('shows a failed check instead of hiding it', async () => {
    monday.boardsUpdatedAt.mockResolvedValue({
      ok: false,
      error: { kind: 'daily-limit', message: 'limit' }
    })
    await checkMondayForChanges()
    expect(useMondayPageStore.getState().scheduleError?.kind).toBe('daily-limit')
    expect(monday.loadSchedule).not.toHaveBeenCalled()
  })
})
