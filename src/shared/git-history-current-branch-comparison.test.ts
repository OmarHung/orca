import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadGitHistoryFromExecutor, type GitHistoryExecutor } from './git-history'

describe('current branch comparison real Git contract', () => {
  const tempPaths: string[] = []

  afterEach(() => {
    for (const path of tempPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  function createRepo(): {
    repoPath: string
    git: (...args: string[]) => string
    commitFile: (file: string, content: string, message: string) => string
    executor: GitHistoryExecutor
  } {
    const repoPath = mkdtempSync(join(tmpdir(), 'orca-cherry-picks-'))
    tempPaths.push(repoPath)
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' })
    git('init', '--quiet', '-b', 'main')
    git('config', 'user.name', 'Orca Test')
    git('config', 'user.email', 'orca@example.test')
    git('config', 'commit.gpgSign', 'false')
    git('config', 'core.hooksPath', '.git/no-hooks')
    const commitFile = (file: string, content: string, message: string): string => {
      writeFileSync(join(repoPath, file), content)
      git('add', file)
      git('commit', '--quiet', '-m', message)
      return git('rev-parse', 'HEAD').trim()
    }
    const executor: GitHistoryExecutor = async (args, cwd) => ({
      stdout: execFileSync('git', args, { cwd, encoding: 'utf8' })
    })
    return { repoPath, git, commitFile, executor }
  }

  it('marks branch commits HEAD already has as a cherry-pick, even past a conflict', async () => {
    const { repoPath, git, commitFile, executor } = createRepo()
    const base = commitFile('base.txt', 'base\n', 'base')
    git('checkout', '--quiet', '-b', 'feature')
    const samePatch = commitFile('b.txt', 'b\n', 'feat b')
    const conflicted = commitFile('c.txt', 'c\n', 'feat c')
    const notPicked = commitFile('d.txt', 'd\n', 'feat d')
    git('checkout', '--quiet', 'main')
    // Why diverge first: a pick straight onto its parent can recreate the identical commit.
    commitFile('c.txt', 'main c\n', 'main own c')
    git('cherry-pick', samePatch)
    expect(() => git('cherry-pick', '-x', conflicted)).toThrow()
    writeFileSync(join(repoPath, 'c.txt'), 'resolved c\n')
    git('add', 'c.txt')
    git('-c', 'core.editor=true', 'cherry-pick', '--continue')

    const marked = await loadGitHistoryFromExecutor(executor, repoPath, {
      revision: 'refs/heads/feature',
      markCherryPicks: true
    })
    expect(marked.cherryPickedIds?.toSorted()).toEqual([samePatch, conflicted].toSorted())
    expect(marked.cherryPickedIds).not.toContain(notPicked)
    expect(marked.headMergeBases).toEqual([base])

    const unmarked = await loadGitHistoryFromExecutor(executor, repoPath, {
      revision: 'refs/heads/feature'
    })
    expect(unmarked).not.toHaveProperty('cherryPickedIds')
    expect(unmarked.headMergeBases).toEqual([base])
  })

  it('only marks cherry-picks for a chosen branch', async () => {
    const { repoPath, commitFile, executor } = createRepo()
    commitFile('base.txt', 'base\n', 'base')
    for (const options of [{}, { allBranches: true }]) {
      const result = await loadGitHistoryFromExecutor(executor, repoPath, {
        ...options,
        markCherryPicks: true
      })
      expect(result).not.toHaveProperty('cherryPickedIds')
    }
  })
})
