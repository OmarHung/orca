// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tabs: { id: string; ptyId: string | null }[] = []
  const sessions: Record<string, { layout: string; terminalStarted: boolean }> = {}
  const noScreen = (): { paneCount: number; isFullScreen: boolean } | null => null
  const paths: Record<string, string> = {}
  return {
    tabs,
    screen: noScreen(),
    paths,
    manualSsh: false,
    connectionStates: new Map<string, { remotePlatform?: string }>(),
    platform: 'darwin',
    sessions,
    toastError: vi.fn(),
    writeAccepted: vi.fn(async (): Promise<boolean> => true),
    getForegroundProcess: vi.fn(async (): Promise<string | null> => 'ssh'),
    setSessionLayout: vi.fn(),
    focus: vi.fn()
  }
})

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('@/lib/focus-terminal-tab-surface', () => ({ focusTerminalTabSurface: mocks.focus }))
vi.mock('@/lib/shortcut-platform', () => ({ getShortcutPlatform: () => mocks.platform }))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      tabsByWorktree: { 'global-ssh-sessions': mocks.tabs },
      sshConnectionStates: mocks.connectionStates
    })
  }
}))
vi.mock('../ssh-page/ssh-session-actions', () => ({ setSessionLayout: mocks.setSessionLayout }))
vi.mock('../ssh-page/remote-session-store', () => ({
  remoteSessionForTab: (sessions: Record<string, unknown>, tabId: string) =>
    sessions[tabId] ?? { layout: 'terminal', terminalStarted: true },
  useRemoteSessionStore: {
    getState: () => ({
      sessions: mocks.sessions,
      remotePathByTab: mocks.paths,
      remoteSelectionByTab: { 'tab-1': ['/srv/app/a'] }
    })
  }
}))
vi.mock('../ssh-page/ssh-session-liveness', () => ({
  isSshProcess: (name: string) => name === 'ssh',
  useSshSessionLivenessStore: {
    getState: () => ({ byTab: { 'tab-1': { hasManualSsh: mocks.manualSsh } } })
  }
}))
vi.mock('../terminal-pane/terminal-pane-manager-registry', () => ({
  readTerminalTabScreen: () => mocks.screen
}))

import {
  checkSshCommandTarget,
  sendSshCommand,
  sshCommandBuiltins,
  sshCommandBlockMessage,
  sshCommandRemotePlatform
} from './ssh-command-send'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tabs = [{ id: 'tab-1', ptyId: 'pty-1' }]
  mocks.screen = { paneCount: 1, isFullScreen: false }
  mocks.platform = 'darwin'
  mocks.sessions = {}
  mocks.paths = { 'tab-1': '/srv/app' }
  mocks.manualSsh = false
  mocks.connectionStates = new Map()
  mocks.writeAccepted.mockResolvedValue(true)
  mocks.getForegroundProcess.mockResolvedValue('ssh')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      pty: {
        writeAccepted: mocks.writeAccepted,
        getForegroundProcess: mocks.getForegroundProcess
      }
    }
  })
})

describe('checkSshCommandTarget', () => {
  it('is ready when ssh is in front', async () => {
    await expect(checkSshCommandTarget('tab-1')).resolves.toEqual({
      kind: 'ready',
      ptyId: 'pty-1',
      doubt: null
    })
  })

  it('doubts an ssh nobody asked Orca for, which may go to another host', async () => {
    mocks.manualSsh = true

    await expect(checkSshCommandTarget('tab-1')).resolves.toEqual({
      kind: 'ready',
      ptyId: 'pty-1',
      doubt: 'manualSsh'
    })
  })

  it.each([
    ['a local shell, where the command would run on this computer', 'zsh', 'localShell'],
    ['a local program that would read it', 'sleep', 'localShell'],
    ['a foreground it cannot read', null, 'unknown']
  ])('refuses %s', async (_label, foreground, reason) => {
    mocks.getForegroundProcess.mockResolvedValue(foreground)

    await expect(checkSshCommandTarget('tab-1')).resolves.toEqual({ kind: 'blocked', reason })
  })

  it('treats an unreadable foreground the same when the read fails', async () => {
    mocks.getForegroundProcess.mockRejectedValue(new Error('gone'))

    await expect(checkSshCommandTarget('tab-1')).resolves.toEqual({
      kind: 'blocked',
      reason: 'unknown'
    })
  })

  it('refuses a full-screen program, even with ssh in front', async () => {
    mocks.screen = { paneCount: 1, isFullScreen: true }

    await expect(checkSshCommandTarget('tab-1')).resolves.toEqual({
      kind: 'blocked',
      reason: 'fullScreen'
    })
  })

  it('refuses a split tab, since the pane to type into is unclear', async () => {
    mocks.screen = { paneCount: 2, isFullScreen: false }

    await expect(checkSshCommandTarget('tab-1')).resolves.toEqual({
      kind: 'blocked',
      reason: 'splitTab'
    })
  })

  it('refuses a terminal that is not mounted, since nothing about its screen is known', async () => {
    mocks.screen = null

    await expect(checkSshCommandTarget('tab-1')).resolves.toEqual({
      kind: 'blocked',
      reason: 'unknown'
    })
  })

  it('refuses a tab whose terminal never started', async () => {
    mocks.sessions = { 'tab-1': { layout: 'files', terminalStarted: false } }

    await expect(checkSshCommandTarget('tab-1')).resolves.toEqual({
      kind: 'blocked',
      reason: 'notConnected'
    })
  })

  it('refuses a tab with no terminal yet', async () => {
    mocks.tabs = [{ id: 'tab-1', ptyId: null }]

    await expect(checkSshCommandTarget('tab-1')).resolves.toEqual({
      kind: 'blocked',
      reason: 'notConnected'
    })
  })

  it('allows Windows but marks it unverified, since its foreground cannot show ssh', async () => {
    mocks.platform = 'win32'
    mocks.getForegroundProcess.mockResolvedValue('pwsh.exe')

    await expect(checkSshCommandTarget('tab-1')).resolves.toEqual({
      kind: 'ready',
      ptyId: 'pty-1',
      doubt: 'noSshEvidence'
    })
  })
})

describe('sendSshCommand', () => {
  it('presses Enter only when running', async () => {
    await sendSshCommand('tab-1', 'uptime', 'run')
    await sendSshCommand('tab-1', 'uptime', 'insert')

    expect(mocks.writeAccepted.mock.calls).toEqual([
      ['pty-1', 'uptime\r', 'driving'],
      ['pty-1', 'uptime', 'driving']
    ])
    expect(mocks.focus).toHaveBeenCalledWith('tab-1')
  })

  it('checks again right before typing, so nothing runs locally after ssh ended', async () => {
    mocks.getForegroundProcess.mockResolvedValue('zsh')

    await expect(sendSshCommand('tab-1', 'rm -rf build', 'run')).resolves.toBe(false)

    expect(mocks.writeAccepted).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(sshCommandBlockMessage('localShell'))
  })

  it('says so when the keystrokes were refused', async () => {
    mocks.writeAccepted.mockResolvedValue(false)

    await expect(sendSshCommand('tab-1', 'uptime', 'run')).resolves.toBe(false)

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.focus).not.toHaveBeenCalled()
  })

  it('brings the terminal into view when only files were showing', async () => {
    mocks.sessions = { 'tab-1': { layout: 'files', terminalStarted: true } }

    await sendSshCommand('tab-1', 'uptime', 'run')

    expect(mocks.setSessionLayout).toHaveBeenCalledWith('tab-1', 'split')
  })
})

describe('sshCommandRemotePlatform', () => {
  it('trusts what a relay reported', () => {
    mocks.connectionStates = new Map([['host', { remotePlatform: 'win32' }]])

    expect(sshCommandRemotePlatform('tab-1', 'host')).toBe('win32')
  })

  it.each(['/C:/Users/admin', 'C:\\Users\\admin', 'c:/srv'])(
    'recognizes a Windows folder such as %s',
    (path) => {
      mocks.paths = { 'tab-1': path }

      expect(sshCommandRemotePlatform('tab-1', 'host')).toBe('win32')
    }
  )

  it('does not guess from an ordinary folder', () => {
    expect(sshCommandRemotePlatform('tab-1', 'host')).toBeUndefined()
  })
})

describe('sshCommandBuiltins', () => {
  it('reads the host, user, folder and selection of the tab', () => {
    const target = { id: 't', label: 'Web', host: '203.0.113.10', port: 22, username: 'deploy' }

    expect(sshCommandBuiltins('tab-1', target)).toEqual({
      host: '203.0.113.10',
      user: 'deploy',
      path: '/srv/app',
      selected: ['/srv/app/a']
    })
  })

  it('has no folder for a tab whose files pane never opened', () => {
    const target = { id: 't', label: 'Web', host: 'h', port: 22, username: 'u' }

    expect(sshCommandBuiltins('tab-2', target)).toMatchObject({ path: null, selected: [] })
  })
})
