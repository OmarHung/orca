import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from './constants'
import {
  addLocalSyntheticWorkspaceIds,
  isLocalSyntheticWorkspaceId,
  MONDAY_BROWSER_WORKTREE_ID,
  SSH_SESSIONS_WORKTREE_ID
} from './local-synthetic-workspace'

describe('isLocalSyntheticWorkspaceId', () => {
  it('recognizes the floating, SSH session and monday browser workspaces', () => {
    expect(isLocalSyntheticWorkspaceId(FLOATING_TERMINAL_WORKTREE_ID)).toBe(true)
    expect(isLocalSyntheticWorkspaceId(SSH_SESSIONS_WORKTREE_ID)).toBe(true)
    expect(isLocalSyntheticWorkspaceId(MONDAY_BROWSER_WORKTREE_ID)).toBe(true)
  })

  it('rejects repo worktrees, folder workspaces and empty ids', () => {
    expect(isLocalSyntheticWorkspaceId('repo-1::/Users/dev/repo')).toBe(false)
    expect(isLocalSyntheticWorkspaceId('folder:abc')).toBe(false)
    expect(isLocalSyntheticWorkspaceId(null)).toBe(false)
    expect(isLocalSyntheticWorkspaceId(undefined)).toBe(false)
    expect(isLocalSyntheticWorkspaceId('')).toBe(false)
  })

  it('keeps the SSH id distinct from the floating one', () => {
    expect(SSH_SESSIONS_WORKTREE_ID).not.toBe(FLOATING_TERMINAL_WORKTREE_ID)
  })
})

describe('addLocalSyntheticWorkspaceIds', () => {
  it('adds every synthetic workspace to a valid-id set', () => {
    const ids = new Set(['repo-1::/Users/dev/repo'])

    addLocalSyntheticWorkspaceIds(ids)

    expect([...ids].sort()).toEqual(
      [
        'repo-1::/Users/dev/repo',
        FLOATING_TERMINAL_WORKTREE_ID,
        SSH_SESSIONS_WORKTREE_ID,
        MONDAY_BROWSER_WORKTREE_ID
      ].sort()
    )
  })
})
