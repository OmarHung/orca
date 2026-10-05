import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { gitCommit, gitInit, type MockDispatcher } from './git-handler-test-setup'
import {
  createGitHandlerRelay,
  createGitTempDir,
  removeGitTempDir
} from './git-handler-test-harness'

describe('GitHandler git.branchAction', () => {
  let dispatcher: MockDispatcher
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createGitTempDir()
    ;({ dispatcher } = createGitHandlerRelay())
    gitInit(tmpDir)
    writeFileSync(path.join(tmpDir, 'a.txt'), 'a\n')
    gitCommit(tmpDir, 'initial')
    execFileSync('git', ['branch', 'feature'], { cwd: tmpDir, stdio: 'pipe' })
  })

  afterEach(async () => {
    await removeGitTempDir(tmpDir)
  })

  const currentBranch = (): string =>
    execFileSync('git', ['branch', '--show-current'], { cwd: tmpDir, encoding: 'utf-8' }).trim()

  it('runs a validated action in the worktree', async () => {
    await expect(
      dispatcher.callRequest('git.branchAction', {
        worktreePath: tmpDir,
        action: { kind: 'checkout', ref: 'refs/heads/feature', mode: 'safe' }
      })
    ).resolves.toEqual({ status: 'ok' })
    expect(currentBranch()).toBe('feature')
  })

  it('refuses actions that fail validation before running git', async () => {
    await expect(
      dispatcher.callRequest('git.branchAction', {
        worktreePath: tmpDir,
        action: { kind: 'checkout', ref: '--orphan=x', mode: 'safe' }
      })
    ).rejects.toThrow(/Invalid branch action/)
    expect(currentBranch()).not.toBe('feature')
  })
})
