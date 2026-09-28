import { describe, expect, it } from 'vitest'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import { branchDisplayName, summarizeBranchStatus } from './branch-status-model'

function entry(path: string, overrides: Partial<GitStatusEntry> = {}): GitStatusEntry {
  return { path, status: 'modified', area: 'unstaged', ...overrides }
}

describe('branchDisplayName', () => {
  it('strips the refs/heads/ prefix and blanks', () => {
    expect(branchDisplayName('refs/heads/feat/x')).toBe('feat/x')
    expect(branchDisplayName('main')).toBe('main')
    expect(branchDisplayName('  ')).toBeNull()
    expect(branchDisplayName(null)).toBeNull()
  })
})

describe('summarizeBranchStatus', () => {
  it('reports ahead/behind from the upstream status', () => {
    expect(
      summarizeBranchStatus({
        branch: 'refs/heads/main',
        head: 'abc1234def',
        entries: [],
        entriesArePartial: false,
        upstream: { hasUpstream: true, upstreamName: 'origin/main', ahead: 2, behind: 3 }
      })
    ).toEqual({
      label: 'main',
      isDetached: false,
      hasUpstream: true,
      upstreamName: 'origin/main',
      ahead: 2,
      behind: 3,
      changedFileCount: 0,
      conflictCount: 0,
      changedFileCountIsPartial: false
    })
  })

  it('counts a file staged and edited again once, and skips submodule internals', () => {
    const summary = summarizeBranchStatus({
      branch: 'main',
      head: undefined,
      entries: [
        entry('a.ts', { area: 'staged' }),
        entry('a.ts'),
        entry('b.ts', { conflictStatus: 'unresolved' }),
        entry('lib/inner.ts', { submoduleRoot: 'lib' })
      ],
      entriesArePartial: true,
      upstream: undefined
    })
    expect(summary).toMatchObject({
      changedFileCount: 2,
      conflictCount: 1,
      changedFileCountIsPartial: true,
      hasUpstream: false,
      ahead: 0,
      behind: 0
    })
  })

  it('names a detached HEAD by its short sha', () => {
    expect(
      summarizeBranchStatus({
        branch: null,
        head: '0123456789abcdef',
        entries: undefined,
        entriesArePartial: false,
        upstream: undefined
      })
    ).toMatchObject({ label: '0123456', isDetached: true })
  })

  it('returns null before the worktree has a branch or HEAD', () => {
    expect(
      summarizeBranchStatus({
        branch: undefined,
        head: undefined,
        entries: undefined,
        entriesArePartial: false,
        upstream: undefined
      })
    ).toBeNull()
  })
})
