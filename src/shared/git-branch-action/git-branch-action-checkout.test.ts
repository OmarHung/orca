import { dirname, join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runGitBranchAction } from './git-branch-action-runner'
import { createGitBranchActionTestRepos } from './git-branch-action.test-fixture'

describe('Git Log checkout actions against real git', () => {
  const repos = createGitBranchActionTestRepos()
  afterEach(() => repos.cleanup())

  function repoWithFeature(): ReturnType<typeof repos.createRepo> {
    const repo = repos.createRepo()
    repo.commitFile('f.txt', 'one\ntwo\nthree\n', 'base')
    repo.git('checkout', '--quiet', '-b', 'feature')
    repo.commitFile('f.txt', 'ONE\ntwo\nthree\n', 'feature edits line one')
    repo.git('checkout', '--quiet', 'main')
    return repo
  }

  const head = (repo: ReturnType<typeof repos.createRepo>): string =>
    repo.git('symbolic-ref', '--quiet', '--short', 'HEAD').trim()

  it('checks out a local branch', async () => {
    const repo = repoWithFeature()
    await expect(
      runGitBranchAction(repo.exec, { kind: 'checkout', ref: 'refs/heads/feature', mode: 'safe' })
    ).resolves.toEqual({ status: 'ok' })
    expect(head(repo)).toBe('feature')
  })

  it('reports local changes the checkout would overwrite, then smart-checks out keeping them', async () => {
    const repo = repoWithFeature()
    repo.write('f.txt', 'one\ntwo\nTHREE\n')

    const refused = await runGitBranchAction(repo.exec, {
      kind: 'checkout',
      ref: 'refs/heads/feature',
      mode: 'safe'
    })
    expect(refused).toEqual({
      status: 'local-changes',
      target: { kind: 'ref', ref: 'refs/heads/feature' },
      files: ['f.txt']
    })
    expect(head(repo)).toBe('main')

    await expect(
      runGitBranchAction(repo.exec, { kind: 'checkout', ref: 'refs/heads/feature', mode: 'smart' })
    ).resolves.toEqual({ status: 'ok' })
    expect(head(repo)).toBe('feature')
    expect(repo.read('f.txt')).toBe('ONE\ntwo\nTHREE\n')
    expect(repo.git('stash', 'list').trim()).toBe('')
  })

  it('keeps the stash when re-applying it after a smart checkout conflicts', async () => {
    const repo = repoWithFeature()
    repo.write('f.txt', 'uno\ntwo\nthree\n')

    await expect(
      runGitBranchAction(repo.exec, { kind: 'checkout', ref: 'refs/heads/feature', mode: 'smart' })
    ).resolves.toEqual({ status: 'conflicts', operation: 'stash' })
    expect(head(repo)).toBe('feature')
    expect(repo.git('stash', 'list')).toContain('Orca smart checkout')
  })

  it('force checkout drops conflicting local changes', async () => {
    const repo = repoWithFeature()
    repo.write('f.txt', 'local\n')

    await expect(
      runGitBranchAction(repo.exec, { kind: 'checkout', ref: 'refs/heads/feature', mode: 'force' })
    ).resolves.toEqual({ status: 'ok' })
    expect(repo.read('f.txt')).toBe('ONE\ntwo\nthree\n')
  })

  it('checks out a remote branch as a new local branch tracking it', async () => {
    const repo = repoWithFeature()
    repo.git('remote', 'add', 'origin', 'https://example.invalid/repo.git')
    repo.git('update-ref', 'refs/remotes/origin/topic', 'feature')

    await expect(
      runGitBranchAction(repo.exec, {
        kind: 'checkout',
        ref: 'refs/remotes/origin/topic',
        mode: 'safe'
      })
    ).resolves.toEqual({ status: 'ok' })
    expect(head(repo)).toBe('topic')
    expect(repo.git('config', '--get', 'branch.topic.remote').trim()).toBe('origin')
    expect(repo.git('config', '--get', 'branch.topic.merge').trim()).toBe('refs/heads/topic')
  })

  it('detaches HEAD at a commit', async () => {
    const repo = repoWithFeature()
    const commit = repo.git('rev-parse', 'feature').trim()

    await expect(
      runGitBranchAction(repo.exec, { kind: 'checkoutRevision', commit, mode: 'safe' })
    ).resolves.toEqual({ status: 'ok' })
    expect(repo.git('rev-parse', 'HEAD').trim()).toBe(commit)
    expect(() => repo.git('symbolic-ref', '--quiet', 'HEAD')).toThrow()
  })

  it('names the worktree that already has the branch checked out', async () => {
    const repo = repoWithFeature()
    const otherPath = join(mkdtempSync(join(tmpdir(), 'orca-branch-action-wt-')), 'other')
    repo.git('worktree', 'add', '--quiet', otherPath, 'feature')

    const result = await runGitBranchAction(repo.exec, {
      kind: 'checkout',
      ref: 'refs/heads/feature',
      mode: 'safe'
    })
    expect(result).toMatchObject({ status: 'checked-out-elsewhere', branch: 'feature' })
    expect(result.status === 'checked-out-elsewhere' && result.worktreePath).toContain('other')
    repo.git('worktree', 'remove', '--force', otherPath)
    rmSync(dirname(otherPath), { recursive: true, force: true })
  })

  it('creates a branch at a commit and checks it out', async () => {
    const repo = repoWithFeature()
    const base = repo.git('rev-parse', 'main').trim()

    await expect(
      runGitBranchAction(repo.exec, {
        kind: 'createBranch',
        name: 'fix/thing',
        startPoint: base,
        checkout: true
      })
    ).resolves.toEqual({ status: 'ok' })
    expect(head(repo)).toBe('fix/thing')
  })

  it('refuses invalid new branch names', async () => {
    const repo = repoWithFeature()
    await expect(
      runGitBranchAction(repo.exec, {
        kind: 'createBranch',
        name: 'bad..name',
        startPoint: 'refs/heads/main',
        checkout: false
      })
    ).rejects.toThrow('"bad..name" is not a valid name.')
  })
})
