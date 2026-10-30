import { describe, expect, it } from 'vitest'
import type { GitHistoryBranch, GitHistoryBranchList } from '../../../../../shared/git-history'
import { resolveGitLogPullSource } from './git-log-pull-source'

const branch = (overrides: Partial<GitHistoryBranch>): GitHistoryBranch => ({
  fullName: 'refs/heads/feature',
  name: 'feature',
  kind: 'local',
  revision: 'a'.repeat(40),
  isHead: false,
  ...overrides
})

const head = (overrides: Partial<GitHistoryBranch> = {}): GitHistoryBranch =>
  branch({ isHead: true, upstream: 'fork/team/feature', behind: 3, ...overrides })

const remote = branch({
  fullName: 'refs/remotes/fork/team/feature',
  name: 'fork/team/feature',
  kind: 'remote'
})

const list = (branches: GitHistoryBranch[], truncated = false): GitHistoryBranchList => ({
  branches,
  truncated
})

describe('resolveGitLogPullSource', () => {
  it("pulls from the checked-out branch's remote-tracking upstream", () => {
    expect(resolveGitLogPullSource(list([head(), remote]))).toEqual({
      ref: 'refs/remotes/fork/team/feature',
      upstream: 'fork/team/feature',
      behind: 3
    })
  })

  it('has nothing to pull without an upstream, a gone upstream or a detached HEAD', () => {
    expect(resolveGitLogPullSource(list([head({ upstream: undefined }), remote]))).toBeNull()
    expect(resolveGitLogPullSource(list([head({ upstreamGone: true }), remote]))).toBeNull()
    expect(
      resolveGitLogPullSource(list([branch({ upstream: 'fork/team/feature' }), remote]))
    ).toBeNull()
  })

  it('skips an upstream that is a local branch rather than a remote one', () => {
    const main = branch({ fullName: 'refs/heads/main', name: 'main' })
    expect(resolveGitLogPullSource(list([head({ upstream: 'main' }), main]))).toBeNull()
  })

  it('trusts the upstream name when the branch list was cut short', () => {
    expect(resolveGitLogPullSource(list([head({ behind: undefined })], true))).toEqual({
      ref: 'refs/remotes/fork/team/feature',
      upstream: 'fork/team/feature',
      behind: 0
    })
  })

  it('waits for the branch list', () => {
    expect(resolveGitLogPullSource(undefined)).toBeNull()
    expect(resolveGitLogPullSource('unsupported')).toBeNull()
  })
})
