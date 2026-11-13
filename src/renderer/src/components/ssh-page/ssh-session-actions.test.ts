// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import { useRemoteSessionStore } from './remote-session-store'
import { useSshSessionLivenessStore } from './ssh-session-liveness'
import {
  adoptSessionlessTabs,
  closeSshSessions,
  migrateLegacySftpTabs,
  openFilesSession,
  openSshSession,
  reconnectSessionTerminal,
  setSessionLayout,
  showHostSession,
  startSessionTerminal
} from './ssh-session-actions'

const mocks = vi.hoisted(() => {
  const state: {
    nextTabId: number
    unified: { id: string; entityId: string }[]
    tabs: { id: string; quickCommandLabel?: string; ptyId?: string | null }[]
  } = { nextTabId: 1, unified: [], tabs: [] }
  return {
    state,
    createTab: vi.fn(() => {
      const id = `tab-${state.nextTabId++}`
      state.unified.push({ id: `unified-${id}`, entityId: id })
      state.tabs.push({ id })
      return { id }
    }),
    queueTabStartupCommand: vi.fn(),
    closeTab: vi.fn(),
    activateTab: vi.fn(),
    setActiveTab: vi.fn(),
    focusTerminalTabSurface: vi.fn(),
    toastError: vi.fn(),
    writeAccepted: vi.fn(async (): Promise<boolean> => true),
    inspectProcess: vi.fn()
  }
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      activeGroupIdByWorktree: { [SSH_SESSIONS_WORKTREE_ID]: 'group-1' },
      createTab: mocks.createTab,
      queueTabStartupCommand: mocks.queueTabStartupCommand,
      closeTab: mocks.closeTab,
      activateTab: mocks.activateTab,
      setActiveTab: mocks.setActiveTab,
      unifiedTabsByWorktree: { [SSH_SESSIONS_WORKTREE_ID]: mocks.state.unified },
      tabsByWorktree: { [SSH_SESSIONS_WORKTREE_ID]: mocks.state.tabs }
    })
  }
}))
vi.mock('@/components/terminal-pane/input/focus/focus-terminal-tab-surface', () => ({
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

function shellAtPrompt(isIdle: boolean | undefined, capturedAgeMs = 0): unknown {
  return {
    foregroundProcess: isIdle ? null : 'bash',
    hasChildProcesses: !isIdle,
    foregroundProcessEvidence: {
      verdict: 'live',
      shellOwnsEveryTtyProcessGroup: isIdle,
      capturedAgeMs
    }
  }
}

function sessions(): ReturnType<typeof useRemoteSessionStore.getState>['sessions'] {
  return useRemoteSessionStore.getState().sessions
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.state.nextTabId = 1
  mocks.state.unified = []
  mocks.state.tabs = []
  useRemoteSessionStore.setState({ sessions: {}, remotePathByTab: {} })
  useSshSessionLivenessStore.setState({ byTab: {} })
  mocks.writeAccepted.mockResolvedValue(true)
  mocks.inspectProcess.mockResolvedValue(shellAtPrompt(true))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { pty: { writeAccepted: mocks.writeAccepted, inspectProcess: mocks.inspectProcess } }
  })
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
    expect(sessions()['tab-1']).toMatchObject({
      targetId: 'web',
      layout: 'terminal',
      terminalStarted: true
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
    expect(sessions()).toEqual({})
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

describe('openFilesSession', () => {
  it('opens a tab without asking anything or running ssh', () => {
    openFilesSession(target)

    expect(mocks.createTab).toHaveBeenCalledTimes(1)
    expect(mocks.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(sessions()['tab-1']).toMatchObject({
      targetId: 'web',
      layout: 'files',
      terminalStarted: false
    })
  })
})

describe('startSessionTerminal', () => {
  it('runs ssh in the existing tab only after the user confirms the command', async () => {
    openFilesSession(target)
    const confirm = vi.fn(async () => true)

    await startSessionTerminal('tab-1', target, confirm)

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ commands: ['ssh web-prod-203.0.113.10'] })
    )
    expect(mocks.createTab).toHaveBeenCalledTimes(1)
    expect(mocks.queueTabStartupCommand).toHaveBeenCalledWith('tab-1', {
      command: 'ssh web-prod-203.0.113.10'
    })
    expect(sessions()['tab-1'].terminalStarted).toBe(true)
  })

  it('leaves the terminal unstarted when the user cancels', async () => {
    openFilesSession(target)

    await startSessionTerminal(
      'tab-1',
      target,
      vi.fn(async () => false)
    )

    expect(mocks.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(sessions()['tab-1'].terminalStarted).toBe(false)
  })
})

describe('startSessionTerminal when the tab closes meanwhile', () => {
  it('runs nothing and records nothing', async () => {
    openFilesSession(target)
    const confirm = vi.fn(async () => {
      mocks.state.tabs = []
      return true
    })

    await startSessionTerminal('tab-1', target, confirm)

    expect(mocks.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(sessions()['tab-1'].terminalStarted).toBe(false)
  })
})

describe('reconnectSessionTerminal', () => {
  const yes = vi.fn(async () => true)

  beforeEach(() => {
    mocks.state.tabs = [{ id: 'tab-1', ptyId: 'pty-1' }]
    useSshSessionLivenessStore.getState().recordForeground('tab-1', 'ssh', 1)
    useSshSessionLivenessStore.getState().recordForeground('tab-1', 'zsh', 2)
  })

  it('clears the prompt and types the confirmed command into the same terminal', async () => {
    await reconnectSessionTerminal('tab-1', target, yes)

    expect(yes).toHaveBeenCalledWith(
      expect.objectContaining({ commands: ['ssh web-prod-203.0.113.10'] })
    )
    expect(mocks.writeAccepted).toHaveBeenCalledWith(
      'pty-1',
      '\u0003ssh web-prod-203.0.113.10\r',
      'driving'
    )
    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(useSshSessionLivenessStore.getState().byTab['tab-1'].liveness).toBe('starting')
  })

  it('types nothing when the user cancels', async () => {
    await reconnectSessionTerminal(
      'tab-1',
      target,
      vi.fn(async () => false)
    )

    expect(mocks.writeAccepted).not.toHaveBeenCalled()
  })

  it('does not interrupt a script running under a shell of the same name', async () => {
    mocks.inspectProcess.mockResolvedValue(shellAtPrompt(false))

    await reconnectSessionTerminal('tab-1', target, yes)

    expect(mocks.writeAccepted).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Something still seems to be running in this tab. Finish it first.'
    )
  })

  it('does not trust a process table older than the decision, which may miss a new script', async () => {
    vi.useFakeTimers()
    try {
      // The shared table predates a script started a moment ago, so it still looks idle.
      mocks.inspectProcess
        .mockResolvedValueOnce(shellAtPrompt(true, 400))
        .mockResolvedValue(shellAtPrompt(false))

      const reconnecting = reconnectSessionTerminal('tab-1', target, yes)
      await vi.advanceTimersByTimeAsync(1_000)
      await reconnecting

      expect(mocks.inspectProcess.mock.calls.length).toBeGreaterThan(1)
      expect(mocks.writeAccepted).not.toHaveBeenCalled()
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Something still seems to be running in this tab. Finish it first.'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('types nothing if it never gets a capture new enough to trust', async () => {
    vi.useFakeTimers()
    try {
      mocks.inspectProcess.mockResolvedValue(shellAtPrompt(true, 86_400_000))

      const reconnecting = reconnectSessionTerminal('tab-1', target, yes)
      await vi.advanceTimersByTimeAsync(5_000)
      await reconnecting

      expect(mocks.writeAccepted).not.toHaveBeenCalled()
      expect(mocks.toastError).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('types nothing, and says so, when the terminal cannot be read', async () => {
    mocks.inspectProcess.mockRejectedValue(new Error('gone'))

    await reconnectSessionTerminal('tab-1', target, yes)

    expect(mocks.writeAccepted).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })

  it('types nothing on a host too old to say whether the prompt is idle', async () => {
    mocks.inspectProcess.mockResolvedValue(shellAtPrompt(undefined))

    await reconnectSessionTerminal('tab-1', target, yes)

    expect(mocks.writeAccepted).not.toHaveBeenCalled()
  })

  it('says so when the tab closed while the dialog was open', async () => {
    const confirm = vi.fn(async () => {
      mocks.state.tabs = []
      return true
    })

    await reconnectSessionTerminal('tab-1', target, confirm)

    expect(mocks.writeAccepted).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })

  it('does not wait for a new ssh when the keystrokes were refused', async () => {
    mocks.writeAccepted.mockResolvedValue(false)

    await reconnectSessionTerminal('tab-1', target, yes)

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(useSshSessionLivenessStore.getState().byTab['tab-1'].liveness).toBe('ended')
  })
})

describe('showHostSession', () => {
  it('goes to a tab already on the host instead of asking to open another', async () => {
    openFilesSession(target)
    const confirm = vi.fn(async () => true)

    await showHostSession(target, confirm, { orderedTabIds: ['tab-1'], activeTabId: null })

    expect(confirm).not.toHaveBeenCalled()
    expect(mocks.createTab).toHaveBeenCalledTimes(1)
    expect(mocks.activateTab).toHaveBeenCalledWith('unified-tab-1')
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab-1')
  })

  it('asks to open a new session when no tab is on the host', async () => {
    const confirm = vi.fn(async () => true)

    await showHostSession(target, confirm, { orderedTabIds: [], activeTabId: null })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(mocks.createTab).toHaveBeenCalledTimes(1)
  })
})

describe('setSessionLayout', () => {
  it('focuses a running terminal when it comes into view, but not an unstarted one', () => {
    openFilesSession(target)
    setSessionLayout('tab-1', 'split')
    expect(mocks.focusTerminalTabSurface).not.toHaveBeenCalled()

    useRemoteSessionStore.getState().markTerminalStarted('tab-1')
    setSessionLayout('tab-1', 'files')
    expect(mocks.focusTerminalTabSurface).not.toHaveBeenCalled()

    setSessionLayout('tab-1', 'terminal')
    expect(sessions()['tab-1'].layout).toBe('terminal')
    expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith('tab-1')
  })
})

describe('migrateLegacySftpTabs', () => {
  it('turns each old SFTP tab into a files tab once, and returns to the one that was active', () => {
    window.localStorage.setItem(
      'orca.sftpTabs',
      JSON.stringify({
        tabs: [
          { id: 'old-1', targetId: 'web', label: 'web-prod' },
          { id: 'old-2', targetId: 'db', label: 'db-prod' }
        ],
        activeTabId: 'old-1'
      })
    )

    migrateLegacySftpTabs()
    migrateLegacySftpTabs()

    expect(mocks.createTab).toHaveBeenCalledTimes(2)
    expect(mocks.queueTabStartupCommand).not.toHaveBeenCalled()
    expect(sessions()).toMatchObject({
      'tab-1': { targetId: 'web', layout: 'files', terminalStarted: false },
      'tab-2': { targetId: 'db', layout: 'files', terminalStarted: false }
    })
    expect(mocks.activateTab).toHaveBeenCalledWith('unified-tab-1')
    expect(window.localStorage.getItem('orca.sftpTabs')).toBeNull()
  })
})

describe('adoptSessionlessTabs', () => {
  it('names the host of tabs from before sessions by their label, and leaves unknown ones', () => {
    mocks.state.tabs = [
      { id: 'old-known', quickCommandLabel: target.label },
      { id: 'old-renamed', quickCommandLabel: 'no-such-host' },
      { id: 'already', quickCommandLabel: target.label }
    ]
    useRemoteSessionStore.getState().addSession({
      tabId: 'already',
      targetId: 'other',
      layout: 'files',
      terminalStarted: false
    })

    adoptSessionlessTabs([target])

    expect(sessions()['old-known']).toMatchObject({
      targetId: 'web',
      layout: 'terminal',
      terminalStarted: true
    })
    expect(sessions()['old-renamed']).toBeUndefined()
    expect(sessions().already.targetId).toBe('other')
  })

  it('does not guess between same-named hosts', () => {
    mocks.state.tabs = [{ id: 'old', quickCommandLabel: target.label }]

    adoptSessionlessTabs([target, { ...target, id: 'twin' }])

    expect(sessions().old).toBeUndefined()
  })

  it('fills in the host of a tab whose layout changed first, keeping that layout', () => {
    mocks.state.tabs = [{ id: 'old', quickCommandLabel: target.label }]
    useRemoteSessionStore.getState().setLayout('old', 'split')

    adoptSessionlessTabs([target])

    expect(sessions().old).toMatchObject({ targetId: 'web', layout: 'split' })
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
