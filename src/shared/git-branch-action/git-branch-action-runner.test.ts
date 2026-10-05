import { afterEach, describe, expect, it } from 'vitest'
import { runGitBranchAction } from './git-branch-action-runner'
import { createGitBranchActionTestRepos } from './git-branch-action.test-fixture'

describe('Git Log branch and commit actions against real git', () => {
  const repos = createGitBranchActionTestRepos()
  afterEach(() => repos.cleanup())

  type Repo = ReturnType<typeof repos.createRepo>

  /** main: base → main-only; feature (from base): feature-only, touching different files. */
  function divergedRepo(): Repo {
    const repo = repos.createRepo()
    repo.commitFile('base.txt', 'base\n', 'base')
    repo.git('checkout', '--quiet', '-b', 'feature')
    repo.commitFile('feature.txt', 'feature\n', 'feature only')
    repo.git('checkout', '--quiet', 'main')
    repo.commitFile('main.txt', 'main\n', 'main only')
    return repo
  }

  const subjects = (repo: Repo, rev: string): string[] =>
    repo.git('log', '--format=%s', rev).trim().split('\n')

  it('merges a branch into the current one with git’s default message', async () => {
    const repo = divergedRepo()
    await expect(
      runGitBranchAction(repo.exec, { kind: 'merge', ref: 'refs/heads/feature' })
    ).resolves.toEqual({ status: 'ok' })
    expect(subjects(repo, 'HEAD')[0]).toBe("Merge branch 'feature'")
  })

  it('stops on merge conflicts, then aborts back to a clean tree', async () => {
    const repo = repos.createRepo()
    repo.commitFile('f.txt', 'base\n', 'base')
    repo.git('checkout', '--quiet', '-b', 'feature')
    repo.commitFile('f.txt', 'feature\n', 'feature edit')
    repo.git('checkout', '--quiet', 'main')
    repo.commitFile('f.txt', 'main\n', 'main edit')

    await expect(
      runGitBranchAction(repo.exec, { kind: 'merge', ref: 'refs/heads/feature' })
    ).resolves.toEqual({ status: 'conflicts', operation: 'merge' })
    await expect(
      runGitBranchAction(repo.exec, { kind: 'abortOperation', operation: 'merge' })
    ).resolves.toEqual({ status: 'ok' })
    expect(repo.git('status', '--porcelain').trim()).toBe('')
  })

  it('rebases the current branch onto another, carrying local changes along', async () => {
    const repo = divergedRepo()
    repo.git('checkout', '--quiet', 'feature')
    repo.write('base.txt', 'local edit\n')

    await expect(
      runGitBranchAction(repo.exec, { kind: 'rebase', ref: 'refs/heads/main' })
    ).resolves.toEqual({ status: 'ok' })
    expect(subjects(repo, 'HEAD')).toEqual(['feature only', 'main only', 'base'])
    expect(repo.read('base.txt')).toBe('local edit\n')
  })

  it('checks out a branch and rebases it onto the current one', async () => {
    const repo = divergedRepo()
    await expect(
      runGitBranchAction(repo.exec, { kind: 'checkoutAndRebase', ref: 'refs/heads/feature' })
    ).resolves.toEqual({ status: 'ok' })
    expect(repo.git('symbolic-ref', '--short', 'HEAD').trim()).toBe('feature')
    expect(subjects(repo, 'HEAD')).toEqual(['feature only', 'main only', 'base'])
  })

  it('renames and deletes branches, asking before dropping unmerged work', async () => {
    const repo = divergedRepo()
    await runGitBranchAction(repo.exec, {
      kind: 'renameBranch',
      ref: 'refs/heads/feature',
      newName: 'topic'
    })
    expect(repo.git('branch', '--list', 'topic').trim()).toContain('topic')

    await expect(
      runGitBranchAction(repo.exec, { kind: 'deleteBranch', ref: 'refs/heads/topic', force: false })
    ).resolves.toEqual({ status: 'not-fully-merged', branch: 'topic' })
    await expect(
      runGitBranchAction(repo.exec, { kind: 'deleteBranch', ref: 'refs/heads/topic', force: true })
    ).resolves.toEqual({ status: 'ok' })
    expect(repo.git('branch', '--list', 'topic').trim()).toBe('')
  })

  it('cherry-picks and reverts commits', async () => {
    const repo = divergedRepo()
    const featureCommit = repo.git('rev-parse', 'feature').trim()

    await runGitBranchAction(repo.exec, { kind: 'cherryPick', commits: [featureCommit] })
    expect(subjects(repo, 'HEAD')[0]).toBe('feature only')

    const picked = repo.git('rev-parse', 'HEAD').trim()
    await runGitBranchAction(repo.exec, { kind: 'revert', commits: [picked] })
    expect(subjects(repo, 'HEAD')[0]).toBe('Revert "feature only"')
  })

  it('resets the current branch with the chosen mode', async () => {
    const repo = divergedRepo()
    const base = repo.git('rev-parse', 'main~1').trim()

    await runGitBranchAction(repo.exec, { kind: 'reset', commit: base, mode: 'soft' })
    expect(repo.git('rev-parse', 'HEAD').trim()).toBe(base)
    expect(repo.git('diff', '--cached', '--name-only').trim()).toBe('main.txt')

    await runGitBranchAction(repo.exec, { kind: 'reset', commit: base, mode: 'hard' })
    expect(repo.git('status', '--porcelain').trim()).toBe('')
  })

  it('creates lightweight and annotated tags', async () => {
    const repo = divergedRepo()
    const commit = repo.git('rev-parse', 'main').trim()

    await runGitBranchAction(repo.exec, { kind: 'createTag', name: 'v1', commit })
    await runGitBranchAction(repo.exec, {
      kind: 'createTag',
      name: 'v2',
      commit,
      message: 'Release two'
    })
    expect(repo.git('cat-file', '-t', 'v1').trim()).toBe('commit')
    expect(repo.git('cat-file', '-t', 'v2').trim()).toBe('tag')
  })

  it('publishes, fetches, pulls and deletes branches on a remote', async () => {
    const remote = repos.createRepo({ bare: true })
    const repo = divergedRepo()
    repo.git('remote', 'add', 'origin', remote.path)

    await runGitBranchAction(repo.exec, { kind: 'push', ref: 'refs/heads/feature' })
    expect(repo.git('config', '--get', 'branch.feature.merge').trim()).toBe('refs/heads/feature')
    expect(remote.git('branch', '--list', 'feature').trim()).toContain('feature')

    // Another clone moves the remote branch on.
    const other = repos.createRepo()
    other.git('remote', 'add', 'origin', remote.path)
    other.git('fetch', '--quiet', 'origin')
    other.git('checkout', '--quiet', '-b', 'feature', 'origin/feature')
    other.commitFile('more.txt', 'more\n', 'more feature')
    other.git('push', '--quiet', 'origin', 'feature')

    await runGitBranchAction(repo.exec, { kind: 'fetch' })
    expect(subjects(repo, 'origin/feature')[0]).toBe('more feature')

    await expect(
      runGitBranchAction(repo.exec, {
        kind: 'pull',
        ref: 'refs/remotes/origin/feature',
        strategy: 'merge'
      })
    ).resolves.toEqual({ status: 'ok' })
    expect(subjects(repo, 'HEAD')[0]).toBe("Merge remote-tracking branch 'origin/feature'")

    await runGitBranchAction(repo.exec, {
      kind: 'deleteBranch',
      ref: 'refs/remotes/origin/feature',
      force: false
    })
    expect(remote.git('branch', '--list', 'feature').trim()).toBe('')
  })
})
