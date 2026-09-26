// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appState, sendRuntimePtyInput, runQuickCommandInNewTab } = vi.hoisted(() => {
  const tabsByWorktree: Record<string, { id: string }[]> = {}
  const ptyIdsByTabId: Record<string, string[]> = {}
  const pendingStartupByTabId: Record<string, { command: string }> = {}
  return {
    appState: {
      settings: null,
      tabsByWorktree,
      ptyIdsByTabId,
      pendingStartupByTabId,
      consumeTabStartupCommand: vi.fn(),
      setActiveTab: vi.fn(),
      setActiveTabType: vi.fn(),
      closeTab: vi.fn()
    },
    sendRuntimePtyInput: vi.fn(() => true),
    runQuickCommandInNewTab: vi.fn()
  }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => appState } }))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({ sendRuntimePtyInput }))
vi.mock('@/lib/run-quick-command-in-new-tab', () => ({ runQuickCommandInNewTab }))

import { dispatchTerminalCommandFinishedEvent } from '@/hooks/terminal-command-finished-event'
import {
  rerunConfiguration,
  runConfiguration,
  runDetectedConfiguration,
  stopConfiguration,
  type RunTarget
} from './run-configuration-control'
import { runSessionKey, useRunSessionStore } from './run-session-store'

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
}

beforeEach(() => {
  useRunSessionStore.setState({ sessionsByKey: {}, lastDetectedRunByWorktree: {} })
  appState.tabsByWorktree = {}
  appState.ptyIdsByTabId = {}
  appState.pendingStartupByTabId = {}
  vi.clearAllMocks()
  runQuickCommandInNewTab.mockImplementation(() => {
    openTab('tab-1')
    return { tabId: 'tab-1' }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runConfiguration', () => {
  it('starts the first run in a new terminal tab and tracks it', async () => {
    await runConfiguration(target)

    expect(runQuickCommandInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt', groupId: 'group', historyId: 'cmd' })
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

    expect(runQuickCommandInNewTab).toHaveBeenCalledTimes(1)
    expect(sendRuntimePtyInput).toHaveBeenCalledWith(null, 'pty-tab-1', 'pnpm dev\r')
    expect(appState.setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('running')
  })

  it('opens a new tab when the previous run tab was closed', async () => {
    await runConfiguration(target)
    dispatchTerminalCommandFinishedEvent('wt', 0, `tab-1:${LEAF}`)
    appState.tabsByWorktree = { wt: [] }

    await runConfiguration(target)

    expect(runQuickCommandInNewTab).toHaveBeenCalledTimes(2)
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
      'group'
    )

    expect(runQuickCommandInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        startupCwd: '/w/api',
        command: expect.objectContaining({
          label: 'Api: Run',
          command: 'dotnet run --project Api.csproj'
        })
      })
    )
    expect(useRunSessionStore.getState().lastDetectedRunByWorktree.wt?.commandKey).toBe(
      'detected:dotnet:/w/api:Api.csproj:run'
    )
    expect(useRunSessionStore.getState().lastDetectedRunByWorktree.wt?.debug).toBeUndefined()
  })
})

describe('stopConfiguration', () => {
  it('sends Ctrl-C first, and closes the tab if pressed again while stopping', async () => {
    await runConfiguration(target)

    stopConfiguration('wt', 'cmd')
    expect(sendRuntimePtyInput).toHaveBeenCalledWith(null, 'pty-tab-1', '\x03')
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('stopping')

    stopConfiguration('wt', 'cmd')
    expect(appState.closeTab).toHaveBeenCalledWith('tab-1')
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('stopped')
  })

  it('cancels a command the shell has not received yet instead of sending Ctrl-C', async () => {
    await runConfiguration(target)
    appState.pendingStartupByTabId = { 'tab-1': { command: 'pnpm dev' } }

    stopConfiguration('wt', 'cmd')

    expect(appState.consumeTabStartupCommand).toHaveBeenCalledWith('tab-1')
    expect(sendRuntimePtyInput).not.toHaveBeenCalledWith(null, 'pty-tab-1', '\x03')
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
    expect(sendRuntimePtyInput).toHaveBeenLastCalledWith(null, 'pty-tab-1', '\x03')
    dispatchTerminalCommandFinishedEvent('wt', 130, `tab-1:${LEAF}`)
    await rerun

    expect(sendRuntimePtyInput).toHaveBeenLastCalledWith(null, 'pty-tab-1', 'pnpm dev\r')
    expect(runQuickCommandInNewTab).toHaveBeenCalledTimes(1)
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('running')
  })

  it('reruns at once when the previous command was still queued', async () => {
    await runConfiguration(target)
    appState.pendingStartupByTabId = { 'tab-1': { command: 'pnpm dev' } }

    await rerunConfiguration(target)

    expect(appState.closeTab).not.toHaveBeenCalled()
    expect(sendRuntimePtyInput).toHaveBeenLastCalledWith(null, 'pty-tab-1', 'pnpm dev\r')
    expect(useRunSessionStore.getState().sessionsByKey[key].status).toBe('running')
  })

  it('closes the tab and starts fresh when the command ignores Ctrl-C', async () => {
    vi.useFakeTimers()
    await runConfiguration(target)
    runQuickCommandInNewTab.mockImplementation(() => {
      openTab('tab-2')
      return { tabId: 'tab-2' }
    })

    const rerun = rerunConfiguration(target)
    await vi.advanceTimersByTimeAsync(3_001)
    await rerun

    expect(appState.closeTab).toHaveBeenCalledWith('tab-1')
    expect(useRunSessionStore.getState().sessionsByKey[key]).toMatchObject({
      tabId: 'tab-2',
      status: 'running'
    })
  })
})
