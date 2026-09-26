// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import type { RunTarget } from './run-configuration-control'
import { addRecentRun, readStoredRecentRuns, useRecentRunStore } from './recent-run-store'

const STORAGE_KEY = 'orca.run.recentByWorktree.v1'

function target(name: string, extra: Partial<RunTarget> = {}): RunTarget {
  return {
    worktreeId: 'wt',
    groupId: 'group-1',
    commandKey: `detected:${name}`,
    cwd: '/repo/wt/api',
    command: { id: `detected:${name}`, label: name, command: `run ${name}`, appendEnter: true },
    ...extra
  }
}

beforeEach(() => {
  window.localStorage.clear()
  useRecentRunStore.setState({ recentByWorktree: {} })
})

describe('addRecentRun', () => {
  it('puts the newest first, keeps one entry per configuration and at most five', () => {
    let list: RunTarget[] = []
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
      list = addRecentRun(list, target(name))
    }
    expect(list.map((entry) => entry.command.label)).toEqual(['f', 'e', 'd', 'c', 'b'])
    list = addRecentRun(list, target('c'))
    expect(list.map((entry) => entry.command.label)).toEqual(['c', 'f', 'e', 'd', 'b'])
  })
})

describe('useRecentRunStore', () => {
  it('persists recent runs per workspace without the tab group', () => {
    useRecentRunStore
      .getState()
      .remember(
        target('api', { debug: { kind: 'dotnet-project', projectFile: '/repo/wt/api/Api.csproj' } })
      )
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '')
    expect(stored.wt[0]).toMatchObject({ groupId: null, commandKey: 'detected:api' })
    expect(readStoredRecentRuns().wt?.[0]).toEqual({
      ...target('api', {
        debug: { kind: 'dotnet-project', projectFile: '/repo/wt/api/Api.csproj' }
      }),
      groupId: null
    })
  })

  it('drops malformed stored entries', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        wt: [
          target('ok'),
          { worktreeId: 'wt', command: 'nope' },
          { ...target('bad-debug'), debug: { kind: 'x' } }
        ],
        other: 'nope'
      })
    )
    expect(readStoredRecentRuns()).toEqual({ wt: [{ ...target('ok'), groupId: null }] })
  })
})
