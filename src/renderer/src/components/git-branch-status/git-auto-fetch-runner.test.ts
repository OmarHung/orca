import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {}
  return { state, fetchRuntimeGit: vi.fn(), fetchUpstreamStatus: vi.fn() }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/store/selectors', () => ({
  getRepoMapFromState: (state: { repos: { id: string }[] }) =>
    new Map(state.repos.map((repo) => [repo.id, repo]))
}))
vi.mock('@/lib/connection-context', () => ({
  getConnectionId: (worktreeId: string) => (worktreeId === 'wt-ssh' ? 'conn-1' : null)
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getSettingsForWorktreeRuntimeOwner: () => ({ activeRuntimeEnvironmentId: null })
}))
vi.mock('@/runtime/runtime-git-client', () => ({ fetchRuntimeGit: mocks.fetchRuntimeGit }))

import { runGitAutoFetch, runGitAutoFetchTick } from './git-auto-fetch-runner'
import { useGitAutoFetchStore } from './git-auto-fetch-store'

const MINUTE = 60_000
const tick = { intervalMs: 15 * MINUTE, enabledAt: 0, startupDelayMs: MINUTE }

function setActiveWorktree(
  worktreeId: string,
  overrides: { repoKind?: 'git' | 'folder'; sshStatus?: string; busy?: boolean } = {}
): void {
  mocks.state = {
    activeWorktreeId: worktreeId,
    activeWorkspaceExecutionHostId: null,
    isRemoteOperationActive: overrides.busy ?? false,
    repos: [{ id: 'repo-1', kind: overrides.repoKind ?? 'git' }],
    sshConnectionStates: new Map([['conn-1', { status: overrides.sshStatus ?? 'connected' }]]),
    getKnownWorktreeById: (id: string) =>
      id === worktreeId ? { id, repoId: 'repo-1', path: `/work/${id}` } : undefined,
    fetchUpstreamStatus: mocks.fetchUpstreamStatus
  }
}

describe('runGitAutoFetchTick', () => {
  beforeEach(() => {
    mocks.fetchRuntimeGit.mockReset().mockResolvedValue(undefined)
    mocks.fetchUpstreamStatus.mockReset().mockResolvedValue(null)
    useGitAutoFetchStore.setState({ recordsByRepo: {}, runningRepoIds: {} })
  })

  it('fetches the active repository once due, then refreshes ahead/behind', async () => {
    setActiveWorktree('wt-1')
    runGitAutoFetchTick({ ...tick, now: 30_000 })
    expect(mocks.fetchRuntimeGit).not.toHaveBeenCalled()

    runGitAutoFetchTick({ ...tick, now: 2 * MINUTE })
    await vi.waitFor(() => expect(mocks.fetchUpstreamStatus).toHaveBeenCalled())
    expect(mocks.fetchRuntimeGit).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt-1', worktreePath: '/work/wt-1' }),
      undefined
    )
    expect(useGitAutoFetchStore.getState().recordsByRepo['repo-1']?.error).toBeNull()
  })

  it('skips folders, busy remotes and disconnected SSH hosts', () => {
    setActiveWorktree('wt-1', { repoKind: 'folder' })
    runGitAutoFetchTick({ ...tick, now: 2 * MINUTE })
    setActiveWorktree('wt-1', { busy: true })
    runGitAutoFetchTick({ ...tick, now: 2 * MINUTE })
    setActiveWorktree('wt-ssh', { sshStatus: 'reconnecting' })
    runGitAutoFetchTick({ ...tick, now: 2 * MINUTE })
    expect(mocks.fetchRuntimeGit).not.toHaveBeenCalled()
  })

  it('records a failure instead of throwing, and waits a full interval to retry', async () => {
    setActiveWorktree('wt-1')
    mocks.fetchRuntimeGit.mockRejectedValue(new Error('Could not resolve host: example.com'))
    await runGitAutoFetch({
      repoId: 'repo-1',
      worktreeId: 'wt-1',
      worktreePath: '/work/wt-1',
      connectionId: undefined,
      pushTarget: undefined,
      settings: { activeRuntimeEnvironmentId: null }
    })
    const record = useGitAutoFetchStore.getState().recordsByRepo['repo-1']
    expect(record?.error).toBeTruthy()
    expect(mocks.fetchUpstreamStatus).not.toHaveBeenCalled()

    runGitAutoFetchTick({ ...tick, now: record!.lastAttemptAt + MINUTE })
    expect(mocks.fetchRuntimeGit).toHaveBeenCalledTimes(1)
  })
})
