import { describe, expect, it } from 'vitest'
import { parseGitBranchAction } from './git-branch-action-parse'
import { parseGitBranchActionResult } from './git-branch-action-result'

describe('parseGitBranchAction', () => {
  it('accepts well-formed actions and drops unknown fields', () => {
    expect(
      parseGitBranchAction({
        kind: 'checkout',
        ref: 'refs/remotes/origin/a/b',
        mode: 'smart',
        x: 1
      })
    ).toEqual({ kind: 'checkout', ref: 'refs/remotes/origin/a/b', mode: 'smart' })
    expect(
      parseGitBranchAction({ kind: 'createBranch', name: ' fix/x ', startPoint: 'abc1234' })
    ).toEqual({ kind: 'createBranch', name: 'fix/x', startPoint: 'abc1234', checkout: false })
    expect(
      parseGitBranchAction({ kind: 'createTag', name: 'v1', commit: 'abcd', message: '' })
    ).toEqual({ kind: 'createTag', name: 'v1', commit: 'abcd' })
  })

  it.each([
    ['an option-like ref', { kind: 'merge', ref: '--upload-pack=evil' }],
    ['a tag ref', { kind: 'merge', ref: 'refs/tags/v1' }],
    ['a parent-walking ref', { kind: 'rebase', ref: 'refs/heads/../x' }],
    ['a ref with spaces', { kind: 'merge', ref: 'refs/heads/a b' }],
    ['a non-hex commit', { kind: 'reset', commit: 'HEAD~1', mode: 'hard' }],
    ['an unknown reset mode', { kind: 'reset', commit: 'abcd', mode: 'merge' }],
    ['an option-like branch name', { kind: 'createBranch', name: '-D', startPoint: 'abcd' }],
    ['renaming a remote branch', { kind: 'renameBranch', ref: 'refs/remotes/o/x', newName: 'y' }],
    ['pushing a remote branch', { kind: 'push', ref: 'refs/remotes/o/x' }],
    ['pulling a local branch', { kind: 'pull', ref: 'refs/heads/x', strategy: 'merge' }],
    ['no commits to pick', { kind: 'cherryPick', commits: [] }],
    ['an unknown kind', { kind: 'gc' }],
    ['a non-object', 'fetch']
  ])('rejects %s', (_label, action) => {
    expect(() => parseGitBranchAction(action)).toThrow(/^Invalid branch action/)
  })
})

describe('parseGitBranchActionResult', () => {
  it('keeps known results and rejects anything else', () => {
    expect(
      parseGitBranchActionResult({
        status: 'local-changes',
        target: { kind: 'ref', ref: 'refs/heads/x' },
        files: ['a.txt', 3]
      })
    ).toEqual({
      status: 'local-changes',
      target: { kind: 'ref', ref: 'refs/heads/x' },
      files: ['a.txt']
    })
    expect(parseGitBranchActionResult({ status: 'conflicts', operation: 'stash' })).toEqual({
      status: 'conflicts',
      operation: 'stash'
    })
    expect(() => parseGitBranchActionResult({ status: 'conflicts', operation: 'bisect' })).toThrow()
    expect(() => parseGitBranchActionResult({ status: 'done' })).toThrow()
    expect(() => parseGitBranchActionResult(null)).toThrow()
  })
})
