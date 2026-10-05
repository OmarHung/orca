import { afterEach, describe, expect, it } from 'vitest'
import { loadGitHistoryFromExecutor } from './git-history'
import { createGitBranchActionTestRepos } from './git-branch-action/git-branch-action.test-fixture'

describe('unpushed commits against real git', () => {
  const repos = createGitBranchActionTestRepos()
  afterEach(() => repos.cleanup())

  const load = (repo: ReturnType<typeof repos.createRepo>) =>
    loadGitHistoryFromExecutor(
      async (args, cwd) => ({ stdout: repo.git('-C', cwd, ...args) }),
      repo.path,
      { markUnpushed: true }
    )

  it('lists commits no remote-tracking branch contains', async () => {
    const remote = repos.createRepo({ bare: true })
    const repo = repos.createRepo()
    repo.git('remote', 'add', 'origin', remote.path)
    const pushed = repo.commitFile('a.txt', 'a\n', 'pushed')
    repo.git('push', '--quiet', '-u', 'origin', 'main')
    const local = repo.commitFile('b.txt', 'b\n', 'local only')

    const result = await load(repo)
    expect(result.unpushedIds).toEqual([local])
    expect(result.items.map((item) => item.id)).toContain(pushed)
  })

  it('counts a commit as pushed when the remote moved past it, even with no upstream', async () => {
    const remote = repos.createRepo({ bare: true })
    const repo = repos.createRepo()
    repo.git('remote', 'add', 'origin', remote.path)
    repo.commitFile('a.txt', 'a\n', 'a')
    repo.git('push', '--quiet', 'origin', 'main:topic')
    const other = repos.createRepo()
    other.git('remote', 'add', 'origin', remote.path)
    other.git('fetch', '--quiet', 'origin')
    other.git('checkout', '--quiet', '-b', 'topic', 'origin/topic')
    other.commitFile('c.txt', 'c\n', 'remote moved on')
    other.git('push', '--quiet', 'origin', 'topic')
    repo.git('fetch', '--quiet')

    expect((await load(repo)).unpushedIds).toEqual([])
  })

  it('reports nothing in a repo without remote-tracking branches', async () => {
    const repo = repos.createRepo()
    repo.commitFile('a.txt', 'a\n', 'a')

    expect((await load(repo)).unpushedIds).toBeUndefined()
  })
})
