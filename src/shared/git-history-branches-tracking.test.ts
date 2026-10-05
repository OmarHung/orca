import { afterEach, describe, expect, it } from 'vitest'
import { loadGitHistoryBranches, parseGitHistoryBranchTrack } from './git-history-branches'
import { createGitBranchActionTestRepos } from './git-branch-action/git-branch-action.test-fixture'

describe('parseGitHistoryBranchTrack', () => {
  it.each([
    ['', {}],
    ['ahead 2', { ahead: 2 }],
    ['behind 3', { behind: 3 }],
    ['ahead 2, behind 13', { ahead: 2, behind: 13 }],
    ['gone', { upstreamGone: true }],
    [undefined, {}]
  ])('reads %j', (track, expected) => {
    expect(parseGitHistoryBranchTrack(track)).toEqual(expected)
  })
})

describe('branch list push/pull state against real git', () => {
  const repos = createGitBranchActionTestRepos()
  afterEach(() => repos.cleanup())

  it('reports commits to push and pull, unpublished branches and deleted upstreams', async () => {
    const remote = repos.createRepo({ bare: true })
    const repo = repos.createRepo()
    repo.git('remote', 'add', 'origin', remote.path)
    repo.commitFile('a.txt', 'a\n', 'a')
    repo.git('push', '--quiet', '-u', 'origin', 'main')
    repo.commitFile('b.txt', 'b\n', 'b')
    repo.git('branch', '--quiet', 'local-only')
    repo.git('checkout', '--quiet', '-b', 'old', 'main~1')
    repo.git('push', '--quiet', '-u', 'origin', 'old')
    repo.git('push', '--quiet', 'origin', '--delete', 'old')
    repo.git('fetch', '--quiet', '--prune')
    // Remote main moves on from another clone, so main is both ahead and behind.
    const other = repos.createRepo()
    other.git('remote', 'add', 'origin', remote.path)
    other.git('pull', '--quiet', 'origin', 'main')
    other.commitFile('c.txt', 'c\n', 'c')
    other.git('push', '--quiet', 'origin', 'main')
    repo.git('fetch', '--quiet')

    const { branches } = await loadGitHistoryBranches(
      async (args, cwd) => ({ stdout: repo.git('-C', cwd, ...args) }),
      repo.path
    )
    const byName = new Map(branches.map((branch) => [branch.name, branch]))
    expect(byName.get('main')).toMatchObject({ upstream: 'origin/main', ahead: 1, behind: 1 })
    expect(byName.get('local-only')?.upstream).toBeUndefined()
    expect(byName.get('old')).toMatchObject({ upstream: 'origin/old', upstreamGone: true })
    expect(byName.get('origin/main')).not.toHaveProperty('ahead')
  })
})
