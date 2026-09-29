import { describe, expect, it } from 'vitest'
import type { GitHistoryResult } from '../../../../../shared/git-history'
import type { GitHistoryPanelState } from '../../right-sidebar/source-control/sync/git-history-panel'
import { finishGitLogLoad, startGitLogLoad } from './git-log-history-state'

function historyResult(ids: string[], branch = 'main'): GitHistoryResult {
  return {
    items: ids.map((id) => ({ id, parentIds: [], subject: `commit ${id}`, message: '' })),
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: false,
    limit: 200,
    refs: {
      branches: [
        {
          fullName: `refs/heads/${branch}`,
          name: branch,
          kind: 'local',
          revision: ids[0],
          isHead: true
        }
      ],
      truncated: false
    }
  }
}

describe('startGitLogLoad', () => {
  it('shows loading when nothing has loaded yet, silent or not', () => {
    expect(startGitLogLoad(undefined, true)).toEqual({ status: 'loading' })
    expect(startGitLogLoad({ status: 'error', error: 'offline' }, false)).toEqual({
      status: 'loading'
    })
  })

  it('spins over the shown log for a manual refresh', () => {
    const result = historyResult(['b', 'a'])
    expect(startGitLogLoad({ status: 'ready', result }, false)).toEqual({
      status: 'refreshing',
      result
    })
  })

  it('leaves the shown log untouched for an automatic reload', () => {
    const ready: GitHistoryPanelState = { status: 'ready', result: historyResult(['b', 'a']) }
    const failed: GitHistoryPanelState = {
      status: 'error',
      result: historyResult(['b', 'a']),
      error: 'offline'
    }
    expect(startGitLogLoad(ready, true)).toBe(ready)
    expect(startGitLogLoad(failed, true)).toBe(failed)
  })
})

describe('finishGitLogLoad', () => {
  it('keeps the same state object when the reloaded log is identical', () => {
    const ready: GitHistoryPanelState = { status: 'ready', result: historyResult(['b', 'a']) }
    expect(finishGitLogLoad(ready, historyResult(['b', 'a']))).toBe(ready)
  })

  it('replaces the log when a commit or a branch changed', () => {
    const ready: GitHistoryPanelState = { status: 'ready', result: historyResult(['b', 'a']) }
    const withCommit = historyResult(['c', 'b', 'a'])
    const withBranch = historyResult(['b', 'a'], 'feature')
    expect(finishGitLogLoad(ready, withCommit)).toEqual({ status: 'ready', result: withCommit })
    expect(finishGitLogLoad(ready, withBranch)).toEqual({ status: 'ready', result: withBranch })
  })

  it('clears a spinner or an error even when the log is unchanged', () => {
    const result = historyResult(['b', 'a'])
    expect(finishGitLogLoad({ status: 'refreshing', result }, historyResult(['b', 'a']))).toEqual({
      status: 'ready',
      result
    })
    expect(
      finishGitLogLoad({ status: 'error', result, error: 'offline' }, historyResult(['b', 'a']))
    ).toEqual({ status: 'ready', result })
  })
})
