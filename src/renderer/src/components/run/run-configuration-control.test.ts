// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'

const { appState, sendRuntimePtyInputVerified, openRunTerminal } = vi.hoisted(() => {
  const tabsByWorktree: Record<string, { id: string }[]> = {}
  const ptyIdsByTabId: Record<string, string[]> = {}
  const terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot> = {}
  const pendingStartupByTabId: Record<string, { command: string }> = {}
  return {
    appState: {
      settings: null,
      tabsByWorktree,
      ptyIdsByTabId,
      terminalLayoutsByTabId,
      pendingStartupByTabId,
      consumeTabStartupCommand: vi.fn(),
      setActiveTab: vi.fn(),
      setActiveTabType: vi.fn(),
      closeTab: vi.fn()
    },
    sendRuntimePtyInputVerified: vi.fn(async () => true),
    openRunTerminal: vi.fn()
  }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => appState } }))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({ sendRuntimePtyInputVerified }))
vi.mock('./run-terminal-open', () => ({ openRunTerminal }))

import { dispatchTerminalCommandFinishedEvent } from '@/hooks/terminal-command-finished-event'
import {
  rerunConfiguration,
  runConfiguration,
  runConfigurationAndWait,
  stopConfiguration,
  type RunTarget
} from './run-configuration-control'
import { runDetectedConfiguration } from './detected-run-configuration'
import { runSessionKey, useRunSessionStore } from './run-session-store'
import { useRecentRunStore } from './recent-run-store'
import { useRunPanelStore } from './run-panel-store'
import type { RunTerminalIds } from './run-terminal-open'
import { useBottomPanelLayout } from '../bottom-panel/bottom-panel-layout-store'

const LEAF = '11111111-1111-4111-8111-111111111111'
const target: RunTarget = {
  worktreeId: 'wt',
  groupId: 'group',
  commandKey: 'cmd',
  command: { id: 'cmd', label: 'Dev', command: 'pnpm dev', appendEnter: true }
}
const key = runSessionKey('wt', 'cmd')

function openTab(tabId: string): void {
  appState.tabsByWorktree = { wt: [{ id: tabId }] }
  appState.ptyIdsByTabId = { [tabId]: [`pty-${tabId}`] }
  appState.terminalLayoutsByTabId = {
    [tabId]: {
      root: { type: 'leaf', leafId: LEAF },
      activeLeafId: LEAF,
      expandedLeafId: null,
      ptyIdsByLeafId: { [LEAF]: `pty-${tabId}` }
    }
  }
}

let bindStartup = true

beforeEach(() => {
  useRunSessionStore.setState({ sessionsByKey: {} })
  useRecentRunStore.setState({ recentByWorktree: {} })
  appState.tabsByWorktree = {}
  appState.ptyIdsByTabId = {}
  appState.terminalLayoutsByTabId = {}
  appState.pendingStartupByTabId = {}
  bindStartup = true
  vi.clearAllMocks()
  openRunTerminal.mockImplementation(
    (_target: RunTarget, beforeCreate: (ids: RunTerminalIds) => void) => {
      beforeCreate({ tabId: 'tab-1', leafId: LEAF })
      openTab('tab-1')
      if (bindStartup) {
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent('orca:terminal-startup-bound', { detail: { paneKey: `tab-1:${LEAF}` } })
          )
        })
      }
      return { tabId: 'tab-1', leafId: LEAF }
    }
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runConfiguration', () => {
  it('starts the first run in a new terminal tab and tracks it', async () => {
    await runConfiguration(target)

    expect(openRunTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt', groupId: 'group', commandKey: 'cmd' }),
      expect.any(Function)
    )
    expect(useRunSessionStore.getState().sessionsByKey[key]).toMatchObject({
      tabId: 'tab-1',
      status: 'running'
    })
  })

  it('reuses the finished run tab instead of opening another', async () => {
    await runConfiguration(target)
    dispatchTerminalCommandFinishedEvent('wt', 0, `tab-1:${LEAF}`)
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('succeeded')

    await runConfiguration(target)

    expect(openRunTerminal).toHaveBeenCalledTimes(1)
    expect(sendRuntimePtyInputVerified).toHaveBeenCalledWith(null, 'pty-tab-1', 'pnpm dev\r')
    expect(useRunPanelStore.getState().selectedByWorktree.wt).toBe('cmd')
    expect(useBottomPanelLayout.getState()).toMatchObject({ open: true, activeTab: 'run' })
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('running')
  })

  it('opens a new tab when the previous run tab was closed', async () => {
    await runConfiguration(target)
    dispatchTerminalCommandFinishedEvent('wt', 0, `tab-1:${LEAF}`)
    appState.tabsByWorktree = { wt: [] }

    await runConfiguration(target)

    expect(openRunTerminal).toHaveBeenCalledTimes(2)
  })
})

describe('runDetectedConfiguration', () => {
  it('runs in the project directory and becomes the worktree current detected run', async () => {
    await runDetectedConfiguration(
      {
        id: 'dotnet:/w/api:Api.csproj:run',
        ecosystem: 'dotnet',
        projectName: 'Api',
        projectDir: '/w/api',
        kind: 'run',
        name: 'Run',
        command: 'dotnet run --project Api.csproj'
      },
      'wt',
      'group',
      async () => true
    )

    expect(openRunTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/w/api',
        command: expect.objectContaining({
          label: 'Api: Run',
          command: 'dotnet run --project Api.csproj'
        })
      }),
      expect.any(Function)
    )
    const [recent] = useRecentRunStore.getState().recentByWorktree.wt ?? []
    expect(recent?.commandKey).toBe('detected:dotnet:/w/api:Api.csproj:run')
    expect(recent?.debug).toBeUndefined()
  })
})

describe('stopConfiguration', () => {
  it('goes one step further per press: Ctrl-C, then SIGQUIT with the terminal kept, then closing it', async () => {
    await runConfiguration(target)

    stopConfiguration('wt', 'cmd')
    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(null, 'pty-tab-1', '\x03')
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('stopping')

    stopConfiguration('wt', 'cmd')
    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(null, 'pty-tab-1', '\x03\x1c')
    expect(appState.closeTab).not.toHaveBeenCalled()
    expect(useRunSessionStore.getState().sessionsByKey[key]).toMatchObject({
      status: 'stopping',
      forceStopped: true
    })

    stopConfiguration('wt', 'cmd')
    expect(appState.closeTab).toHaveBeenCalledWith('tab-1')
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('stopped')
  })

  it('starts over from Ctrl-C when the run is started again', async () => {
    await runConfiguration(target)
    stopConfiguration('wt', 'cmd')
    stopConfiguration('wt', 'cmd')
    dispatchTerminalCommandFinishedEvent('wt', 131, `tab-1:${LEAF}`)
    await runConfiguration(target)

    stopConfiguration('wt', 'cmd')

    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(null, 'pty-tab-1', '\x03')
    expect(useRunSessionStore.getState().sessionsByKey[key].forceStopped).toBeUndefined()
  })

  it('cancels a command the shell has not received yet instead of sending Ctrl-C', async () => {
    bindStartup = false
    await runConfiguration(target)
    appState.pendingStartupByTabId = { 'tab-1': { command: 'pnpm dev' } }

    stopConfiguration('wt', 'cmd')

    expect(appState.consumeTabStartupCommand).toHaveBeenCalledWith('tab-1')
    expect(sendRuntimePtyInputVerified).not.toHaveBeenCalledWith(null, 'pty-tab-1', '\x03')
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('stopped')
  })

  it('marks a run that ends after Ctrl-C as stopped', async () => {
    await runConfiguration(target)
    stopConfiguration('wt', 'cmd')

    dispatchTerminalCommandFinishedEvent('wt', 130, `tab-1:${LEAF}`)

    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('stopped')
  })
})

describe('rerunConfiguration', () => {
  it('interrupts the running command, waits for it to end, then runs again in the same tab', async () => {
    await runConfiguration(target)

    const rerun = rerunConfiguration(target)
    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(null, 'pty-tab-1', '\x03')
    dispatchTerminalCommandFinishedEvent('wt', 130, `tab-1:${LEAF}`)
    await rerun

    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(null, 'pty-tab-1', 'pnpm dev\r')
    expect(openRunTerminal).toHaveBeenCalledTimes(1)
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('running')
  })

  it('reruns at once when the previous command was still queued', async () => {
    bindStartup = false
    await runConfiguration(target)
    appState.pendingStartupByTabId = { 'tab-1': { command: 'pnpm dev' } }

    await rerunConfiguration(target)

    expect(appState.closeTab).not.toHaveBeenCalled()
    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(null, 'pty-tab-1', 'pnpm dev\r')
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('running')
  })

  it('forces, then closes the tab and starts fresh when the command ignores Ctrl-C', async () => {
    vi.useFakeTimers()
    await runConfiguration(target)
    openRunTerminal.mockImplementation(
      (_target: RunTarget, beforeCreate: (ids: RunTerminalIds) => void) => {
        beforeCreate({ tabId: 'tab-2', leafId: LEAF })
        openTab('tab-2')
        return { tabId: 'tab-2', leafId: LEAF }
      }
    )

    const rerun = rerunConfiguration(target)
    await vi.advanceTimersByTimeAsync(3_001)
    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(null, 'pty-tab-1', '\x03\x1c')
    expect(appState.closeTab).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_001)
    await rerun

    expect(appState.closeTab).toHaveBeenCalledWith('tab-1')
    expect(useRunSessionStore.getState().sessionsByKey[key]).toMatchObject({
      tabId: 'tab-2',
      status: 'queued'
    })
  })

  it('coalesces repeated rerun requests into one terminal restart', async () => {
    await runConfiguration(target)

    const first = rerunConfiguration(target)
    const second = rerunConfiguration(target)
    dispatchTerminalCommandFinishedEvent('wt', 130, `tab-1:${LEAF}`)
    await Promise.all([first, second])

    expect(sendRuntimePtyInputVerified).toHaveBeenCalledTimes(2)
    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(null, 'pty-tab-1', 'pnpm dev\r')
  })
})

describe('rerunConfiguration after forcing', () => {
  it('keeps the tab when the forceful signals end the old run', async () => {
    vi.useFakeTimers()
    await runConfiguration(target)

    const rerun = rerunConfiguration(target)
    await vi.advanceTimersByTimeAsync(3_001)
    dispatchTerminalCommandFinishedEvent('wt', 131, `tab-1:${LEAF}`)
    await rerun

    expect(appState.closeTab).not.toHaveBeenCalled()
    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(null, 'pty-tab-1', 'pnpm dev\r')
  })
})

describe('runConfigurationAndWait', () => {
  it('resolves with the exit code the shell reports', async () => {
    const exit = runConfigurationAndWait(target)
    await vi.waitFor(() => expect(openRunTerminal).toHaveBeenCalled())
    dispatchTerminalCommandFinishedEvent('wt', 2, `tab-1:${LEAF}`)
    await expect(exit).resolves.toEqual({ status: 'failed', exitCode: 2 })
  })

  it('reports a stop when the run is stopped', async () => {
    const exit = runConfigurationAndWait(target)
    await vi.waitFor(() => expect(openRunTerminal).toHaveBeenCalled())
    stopConfiguration('wt', 'cmd')
    dispatchTerminalCommandFinishedEvent('wt', 130, `tab-1:${LEAF}`)
    await expect(exit).resolves.toEqual({ status: 'stopped', exitCode: 130 })
  })

  it('reports a stop when the run tab is closed', async () => {
    vi.useFakeTimers()
    const exit = runConfigurationAndWait(target)
    await vi.advanceTimersByTimeAsync(0)
    appState.tabsByWorktree = {}
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(exit).resolves.toEqual({ status: 'stopped', exitCode: null })
  })

  it('fails at once when no terminal could be opened', async () => {
    openRunTerminal.mockImplementation(() => null)
    await expect(runConfigurationAndWait(target)).resolves.toEqual({
      status: 'stopped',
      exitCode: null
    })
  })
})

describe('stable pane ownership', () => {
  it('ignores a command finish from a sibling pane in the run tab', async () => {
    await runConfiguration(target)

    dispatchTerminalCommandFinishedEvent('wt', 0, 'tab-1:22222222-2222-4222-8222-222222222222')

    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('running')
  })

  it('follows the owned pane when it is detached into another tab', async () => {
    await runConfiguration(target)
    dispatchTerminalCommandFinishedEvent('wt', 0, `tab-1:${LEAF}`)
    openTab('tab-detached')

    await runConfiguration(target)

    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(
      null,
      'pty-tab-detached',
      'pnpm dev\r'
    )
    expect(useRunSessionStore.getState().sessionsByKey[key].tabId).toBe('tab-detached')
  })

  it('stops the owned split pane instead of the tab first PTY', async () => {
    await runConfiguration(target)
    const siblingLeaf = '22222222-2222-4222-8222-222222222222'
    appState.ptyIdsByTabId = { 'tab-1': ['pty-sibling', 'pty-run'] }
    appState.terminalLayoutsByTabId = {
      'tab-1': {
        root: {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'leaf', leafId: siblingLeaf },
          second: { type: 'leaf', leafId: LEAF }
        },
        activeLeafId: siblingLeaf,
        expandedLeafId: null,
        ptyIdsByLeafId: { [siblingLeaf]: 'pty-sibling', [LEAF]: 'pty-run' }
      }
    }

    stopConfiguration('wt', 'cmd')

    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(null, 'pty-run', '\x03')
  })

  it('closes only the owned pane at the final stop stage', async () => {
    await runConfiguration(target)
    const siblingLeaf = '22222222-2222-4222-8222-222222222222'
    appState.ptyIdsByTabId = { 'tab-1': ['pty-sibling', 'pty-run'] }
    appState.terminalLayoutsByTabId = {
      'tab-1': {
        root: {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'leaf', leafId: siblingLeaf },
          second: { type: 'leaf', leafId: LEAF }
        },
        activeLeafId: siblingLeaf,
        expandedLeafId: null,
        ptyIdsByLeafId: { [siblingLeaf]: 'pty-sibling', [LEAF]: 'pty-run' }
      }
    }
    const closePane = vi.fn()
    window.addEventListener('orca-close-terminal-pane', closePane)

    stopConfiguration('wt', 'cmd')
    stopConfiguration('wt', 'cmd')
    stopConfiguration('wt', 'cmd')

    expect(closePane).toHaveBeenCalledTimes(1)
    const event = closePane.mock.calls[0]?.[0]
    expect(event).toBeInstanceOf(CustomEvent)
    if (!(event instanceof CustomEvent)) {
      throw new Error('expected pane close event')
    }
    expect(event.detail).toMatchObject({
      tabId: 'tab-1',
      leafId: LEAF,
      expectedPtyId: 'pty-run'
    })
    expect(appState.closeTab).not.toHaveBeenCalled()
    window.removeEventListener('orca-close-terminal-pane', closePane)
  })

  it('marks a rejected remote stop unverifiable instead of claiming the process exited', async () => {
    await runConfiguration(target)
    sendRuntimePtyInputVerified.mockRejectedValueOnce(new Error('offline'))

    stopConfiguration('wt', 'cmd')
    await vi.waitFor(() =>
      expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('unverifiable')
    )

    expect(useRunSessionStore.getState().sessionsByKey[key].exitCode).toBeNull()
  })
})
