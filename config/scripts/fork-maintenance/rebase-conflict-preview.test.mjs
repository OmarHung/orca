import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { previewRebaseConflicts } from './rebase-conflict-preview.mjs'

let repo

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

function commitFile(file, content, message) {
  writeFileSync(path.join(repo, file), content)
  git('add', file)
  git('commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'rebase-preview-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.com')
  git('config', 'commit.gpgsign', 'false')
  commitFile('shared.txt', 'one\ntwo\nthree\n', 'base')
  writeFileSync(path.join(repo, 'other.txt'), 'other\n')
  git('add', 'other.txt')
  git('commit', '-q', '-m', 'base other')
  git('tag', 'v1.0.0')
  commitFile('shared.txt', 'one\nupstream\nthree\n', 'upstream edit')
  git('tag', 'v1.1.0')
  git('switch', '-q', '-c', 'fork', 'v1.0.0')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('previewRebaseConflicts', () => {
  it('lists each conflicting commit once, checking later commits against the fork side', () => {
    const conflicting = commitFile('shared.txt', 'one\nfork\nthree\n', 'fork edit')
    commitFile('other.txt', 'fork other\n', 'clean fork commit')
    commitFile('shared.txt', 'one\nfork again\nthree\n', 'builds on the fork edit')
    const branchBefore = git('rev-parse', 'fork')

    const conflicts = previewRebaseConflicts({
      cwd: repo,
      base: 'v1.0.0',
      branch: 'fork',
      onto: 'v1.1.0'
    })

    expect(conflicts).toEqual([{ sha: conflicting, subject: 'fork edit', files: ['shared.txt'] }])
    expect(git('rev-parse', 'fork')).toBe(branchBefore)
    expect(git('status', '--porcelain')).toBe('')
  })

  it('returns nothing when every commit applies cleanly', () => {
    commitFile('other.txt', 'fork other\n', 'clean fork commit')

    expect(
      previewRebaseConflicts({ cwd: repo, base: 'v1.0.0', branch: 'fork', onto: 'v1.1.0' })
    ).toEqual([])
  })

  it('throws when git cannot run the merge', () => {
    commitFile('other.txt', 'fork other\n', 'clean fork commit')

    expect(() =>
      previewRebaseConflicts({ cwd: repo, base: 'v1.0.0', branch: 'fork', onto: 'v9.9.9' })
    ).toThrow()
  })
})
