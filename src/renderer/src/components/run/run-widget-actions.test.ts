import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stopConfiguration: vi.fn(),
  stopDebugSession: vi.fn(async () => {}),
  cancelPendingLaunches: vi.fn()
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('@/lib/run-quick-command-in-new-tab', () => ({ runQuickCommandInNewTab: vi.fn() }))
vi.mock('../debug/debug-launch', () => ({ debugLaunchTarget: vi.fn() }))
vi.mock('../debug/debug-session-controller', () => ({ stopDebugSession: mocks.stopDebugSession }))
vi.mock('./run-debug-exclusivity', () => ({
  stopDebuggingBeforeRun: vi.fn(),
  stopRunBeforeDebug: vi.fn()
}))
vi.mock('./run-configuration-control', () => ({
  runConfiguration: vi.fn(),
  stopConfiguration: mocks.stopConfiguration,
  toRunTarget: vi.fn()
}))
vi.mock('./run-configuration-launcher', () => ({
  cancelPendingLaunches: mocks.cancelPendingLaunches,
  configurationRunTarget: vi.fn(),
  launchRunConfiguration: vi.fn()
}))

import type { RunSession } from './run-session-store'
import { stopAllRunningProcesses, stopRunWidgetItem } from './run-widget-actions'
import type { RunningProcess } from './run-widget-activity'
import type { RunWidgetItem } from './run-widget-items'

function run(commandKey: string, overrides: Partial<RunSession> = {}): RunSession {
  return {
    key: `wt\u0000${commandKey}`,
    worktreeId: 'wt',
    commandKey,
    label: commandKey,
    tabId: `tab-${commandKey}`,
    leafId: `leaf-${commandKey}`,
    attemptId: `attempt-${commandKey}`,
    status: 'running',
    exitCode: null,
    ...overrides
  }
}

const compound: RunWidgetItem = {
  kind: 'configuration',
  key: 'config:all',
  label: 'Run:all',
  source: 'local',
  configuration: { type: 'compound', id: 'all', name: 'Run:all', configurations: ['a', 'b', 'c'] }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('stopRunWidgetItem', () => {
  it('only takes the members at the gentlest step one step further', () => {
    stopRunWidgetItem(
      compound,
      { commandKeys: ['a', 'b', 'c'], debugSourceKeys: ['config:all'] },
      {
        runs: [
          run('a', { status: 'stopping', forceStopped: true }),
          run('b', { status: 'stopping' }),
          run('c', { status: 'stopping' })
        ],
        debug: null
      },
      'wt'
    )

    expect(mocks.cancelPendingLaunches).toHaveBeenCalledWith('wt', 'all')
    // Forcing b and c must not close a's terminal in the same press.
    expect(mocks.stopConfiguration.mock.calls).toEqual([
      ['wt', 'b'],
      ['wt', 'c']
    ])
    expect(mocks.stopDebugSession).not.toHaveBeenCalled()
  })
})

describe('stopAllRunningProcesses', () => {
  it('interrupts the running ones first, and stops the debug session', () => {
    const processes: RunningProcess[] = [
      { kind: 'run', key: 'k1', label: 'a', commandKey: 'a', stage: 'force' },
      { kind: 'run', key: 'k2', label: 'b', commandKey: 'b', stage: 'interrupt' },
      { kind: 'debug', key: 'debug:1', label: 'Api' }
    ]

    stopAllRunningProcesses(processes, 'wt')

    expect(mocks.cancelPendingLaunches).toHaveBeenCalledWith('wt')
    expect(mocks.stopConfiguration.mock.calls).toEqual([['wt', 'b']])
    expect(mocks.stopDebugSession).toHaveBeenCalledTimes(1)
  })
})
