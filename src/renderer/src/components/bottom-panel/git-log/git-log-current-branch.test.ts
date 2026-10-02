import { describe, expect, it } from 'vitest'
import type { GitHistoryItem, GitHistoryResult } from '../../../../../shared/git-history'
import { collectGitLogCurrentBranchIds } from './git-log-current-branch'
import { ALL_GIT_LOG_SCOPE, HEAD_GIT_LOG_SCOPE, type GitLogScope } from './git-log-scope'

const FEATURE_SCOPE: GitLogScope = { kind: 'ref', fullName: 'refs/heads/feature' }

// main: a <- b <- c <- h (HEAD)    feature: b <- e <- f
function item(id: string, parentIds: string[] = []): GitHistoryItem {
  return { id, parentIds, subject: id, message: id }
}

const A = item('a')
const B = item('b', ['a'])
const C = item('c', ['b'])
const H = item('h', ['c'])
const E = item('e', ['b'])
const F = item('f', ['e'])

function result(overrides: Partial<GitHistoryResult>): GitHistoryResult {
  return {
    items: [],
    currentRef: { id: 'refs/heads/main', name: 'main', revision: 'h', category: 'branches' },
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: false,
    limit: 200,
    ...overrides
  }
}

function sorted(ids: ReadonlySet<string> | null): string[] | null {
  return ids ? [...ids].sort() : null
}

describe('collectGitLogCurrentBranchIds', () => {
  it('marks a chosen branch’s commits that HEAD also has', () => {
    const logged = result({ items: [F, E, B, A], revisionScope: 'ref', headMergeBases: ['b'] })
    expect(sorted(collectGitLogCurrentBranchIds(logged, FEATURE_SCOPE))).toEqual(['a', 'b'])
  })

  it('marks HEAD’s ancestry in the all-branches log', () => {
    const logged = result({ items: [H, F, C, E, B, A], revisionScope: 'all' })
    expect(sorted(collectGitLogCurrentBranchIds(logged, ALL_GIT_LOG_SCOPE))).toEqual([
      'a',
      'b',
      'c',
      'h'
    ])
  })

  it('follows every merge base of a criss-cross history', () => {
    const x = item('x', ['a'])
    const y = item('y', ['a'])
    const tip = item('tip', ['x', 'y'])
    const logged = result({
      items: [tip, x, y, A],
      revisionScope: 'ref',
      headMergeBases: ['x', 'y']
    })
    expect(sorted(collectGitLogCurrentBranchIds(logged, FEATURE_SCOPE))).toEqual(['a', 'x', 'y'])
  })

  it('marks nothing when the shared history is past the loaded commits', () => {
    const logged = result({ items: [F, E], revisionScope: 'ref', headMergeBases: ['b'] })
    expect(sorted(collectGitLogCurrentBranchIds(logged, FEATURE_SCOPE))).toEqual([])
  })

  it('does not highlight the current branch’s own log', () => {
    const items = [H, C, B, A]
    expect(
      collectGitLogCurrentBranchIds(result({ items, revisionScope: 'head' }), HEAD_GIT_LOG_SCOPE)
    ).toBeNull()
    const mainScope: GitLogScope = { kind: 'ref', fullName: 'refs/heads/main' }
    const logged = result({ items, revisionScope: 'ref', headMergeBases: ['h'] })
    expect(collectGitLogCurrentBranchIds(logged, mainScope)).toBeNull()
  })

  it('claims nothing from a host that reports no merge bases or no HEAD', () => {
    const items = [F, E, B, A]
    expect(
      collectGitLogCurrentBranchIds(result({ items, revisionScope: 'ref' }), FEATURE_SCOPE)
    ).toBeNull()
    // An older host ignores the scope and omits revisionScope.
    expect(collectGitLogCurrentBranchIds(result({ items }), ALL_GIT_LOG_SCOPE)).toBeNull()
    const unborn = result({ items, revisionScope: 'all', currentRef: undefined })
    expect(collectGitLogCurrentBranchIds(unborn, ALL_GIT_LOG_SCOPE)).toBeNull()
  })
})
