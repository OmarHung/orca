import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import { closeSshSessions, openSshSession } from './ssh-session-actions'

const mocks = vi.hoisted(() => ({
  createTab: vi.fn(() => ({ id: 'tab-1' })),
  queueTabStartupCommand: vi.fn(),
  closeTab: vi.fn(),
  focusTerminalTabSurface: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      activeGroupIdByWorktree: { [SSH_SESSIONS_WORKTREE_ID]: 'group-1' },
      createTab: mocks.createTab,
      queueTabStartupCommand: mocks.queueTabStartupCommand,
      closeTab: mocks.closeTab
    })
  }
}))
vi.mock('@/lib/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: mocks.focusTerminalTabSurface
}))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

const target: SshTarget = {
  id: 'web',
  label: 'web-prod-203.0.113.10',
  configHost: 'web-prod-203.0.113.10',
  host: '203.0.113.10',
  port: 22,
  username: 'deploy'
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openSshSession', () => {
  it('shows the exact command, then opens a tab that runs it once confirmed', async () => {
    const confirm = vi.fn(async () => true)

    await openSshSession(target, confirm)

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ commands: ['ssh web-prod-203.0.113.10'] })
    )

    expect(mocks.createTab).toHaveBeenCalledWith(SSH_SESSIONS_WORKTREE_ID, 'group-1', undefined, {
      quickCommandLabel: 'web-prod-203.0.113.10'
    })
    expect(mocks.queueTabStartupCommand).toHaveBeenCalledWith('tab-1', {
      command: 'ssh web-prod-203.0.113.10'
    })
    expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith('tab-1')
  })

  it('opens nothing when the user cancels', async () => {
    await openSshSession(
      target,
      vi.fn(async () => false)
    )

    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.queueTabStartupCommand).not.toHaveBeenCalled()
  })

  it('opens nothing for a host name that is unsafe to type into a shell', async () => {
    const confirm = vi.fn(async () => true)

    await openSshSession({ ...target, configHost: '-oProxyCommand=sh' }, confirm)

    expect(confirm).not.toHaveBeenCalled()

    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })
})

describe('closeSshSessions', () => {
  it('closes each tab without per-tab prompts', () => {
    closeSshSessions(['tab-1', 'tab-2'])

    expect(mocks.closeTab.mock.calls).toEqual([
      ['tab-1', { reason: 'cleanup' }],
      ['tab-2', { reason: 'cleanup' }]
    ])
  })
})
