import { describe, expect, it } from 'vitest'
import type { GitHistoryBranch } from '../../../../../shared/git-history'
import { describeGitLogBranch } from './git-log-branch-sync'

const local = (overrides: Partial<GitHistoryBranch>): GitHistoryBranch => ({
  fullName: 'refs/heads/feature',
  name: 'feature',
  kind: 'local',
  revision: 'a'.repeat(40),
  isHead: false,
  ...overrides
})

describe('describeGitLogBranch', () => {
  it('spells out commits to push and pull', () => {
    expect(
      describeGitLogBranch(local({ upstream: 'origin/feature', ahead: 2, behind: 1 }), true)
    ).toBe('feature → origin/feature · 2 to push, 1 to pull')
    expect(describeGitLogBranch(local({ upstream: 'origin/feature' }), true)).toBe(
      'feature → origin/feature'
    )
  })

  it('says a branch was never pushed only when the repo has remotes', () => {
    expect(describeGitLogBranch(local({}), true)).toBe(
      'feature · Not pushed to a remote (no upstream branch)'
    )
    expect(describeGitLogBranch(local({}), false)).toBe('feature')
  })

  it('flags an upstream deleted on the remote', () => {
    expect(
      describeGitLogBranch(local({ upstream: 'origin/feature', upstreamGone: true }), true)
    ).toBe('feature → origin/feature · Upstream branch deleted on the remote')
  })
})
