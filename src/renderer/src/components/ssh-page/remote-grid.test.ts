import { describe, expect, it } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { planRemoteGridHosts, remoteGridCells } from './remote-grid'
import type { RemoteSession } from './remote-session-store'

const WIDE = 4000

function shape(count: number, width = WIDE): number[][] {
  const rows = new Map<number, number>()
  for (const cell of remoteGridCells(count, width)) {
    rows.set(cell.top, (rows.get(cell.top) ?? 0) + 1)
  }
  return [[...rows.values()]]
}

describe('remoteGridCells', () => {
  it('fills the area with one pane', () => {
    expect(remoteGridCells(1, WIDE)).toEqual([{ top: 0, left: 0, width: 100, height: 100 }])
  })

  it('puts two side by side', () => {
    expect(remoteGridCells(2, WIDE)).toEqual([
      { top: 0, left: 0, width: 50, height: 100 },
      { top: 0, left: 50, width: 50, height: 100 }
    ])
  })

  it.each([
    [3, [2, 1]],
    [4, [2, 2]],
    [5, [3, 2]],
    [6, [3, 3]],
    [7, [3, 3, 1]],
    [8, [3, 3, 2]],
    [9, [3, 3, 3]]
  ])('lays out %i panes as rows of %j', (count, rows) => {
    expect(shape(count)).toEqual([rows])
  })

  it.each([2, 3, 5, 7, 8, 9])('covers the whole area with %i panes, without overlap', (count) => {
    const cells = remoteGridCells(count, WIDE)
    const area = cells.reduce((sum, cell) => sum + cell.width * cell.height, 0)

    expect(area).toBeCloseTo(100 * 100)
    for (const cell of cells) {
      expect(cell.left + cell.width).toBeLessThanOrEqual(100.0001)
      expect(cell.top + cell.height).toBeLessThanOrEqual(100.0001)
    }
  })

  it('gives up columns when panes would be too narrow to read', () => {
    expect(shape(2, 500)).toEqual([[1, 1]])
    expect(shape(9, 800)).toEqual([[2, 2, 2, 2, 1]])
  })

  it('keeps the planned columns until the area has been measured', () => {
    expect(shape(4, 0)).toEqual([[2, 2]])
  })

  it('has nothing to lay out with no panes', () => {
    expect(remoteGridCells(0, WIDE)).toEqual([])
  })
})

describe('planRemoteGridHosts', () => {
  const host = (id: string): SshTarget => ({
    id,
    label: id,
    host: '203.0.113.10',
    port: 22,
    username: 'deploy'
  })
  const session = (tabId: string, targetId: string, terminalStarted: boolean): RemoteSession => ({
    tabId,
    targetId,
    layout: 'terminal',
    dockHeight: 280,
    terminalStarted
  })

  it('opens a new tab for a host with none', () => {
    expect(planRemoteGridHosts([host('a')], [], {}, [])).toEqual([
      { kind: 'open', target: host('a') }
    ])
  })

  it('reuses a tab already running, instead of opening a second ssh', () => {
    const sessions = { t1: session('t1', 'a', true) }

    expect(planRemoteGridHosts([host('a')], ['t1'], sessions, [])).toEqual([
      { kind: 'reuse', tabId: 't1' }
    ])
  })

  it('starts the terminal of a tab that has only shown files', () => {
    const sessions = { t1: session('t1', 'a', false) }

    expect(planRemoteGridHosts([host('a')], ['t1'], sessions, [])).toEqual([
      { kind: 'start', tabId: 't1', target: host('a') }
    ])
  })

  it('prefers a running tab over a files-only one on the same host', () => {
    const sessions = { t1: session('t1', 'a', false), t2: session('t2', 'a', true) }

    expect(planRemoteGridHosts([host('a')], ['t1', 't2'], sessions, [])).toEqual([
      { kind: 'reuse', tabId: 't2' }
    ])
  })

  it('prefers the tab already in the grid, so adding its host changes nothing', () => {
    const sessions = { t1: session('t1', 'a', true), t2: session('t2', 'a', true) }

    expect(planRemoteGridHosts([host('a')], ['t1', 't2'], sessions, ['t2'])).toEqual([
      { kind: 'reuse', tabId: 't2' }
    ])
  })
})
