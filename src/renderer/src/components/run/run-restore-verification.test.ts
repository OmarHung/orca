// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalProcessInspection } from '../../../../shared/terminal-process-inspection'
import type * as RunSessionStoreModule from './run-session-store'

type State = Record<string, unknown>
type Listener = (state: State, previous: State) => void

const mocks = vi.hoisted(() => {
  const initial = (): State => ({
    settings: null,
    tabsByWorktree: { wt: [{ id: 'tab-1' }] },
    terminalLayoutsByTabId: {
      'tab-1': { root: { type: 'leaf', leafId: 'leaf-1' }, ptyIdsByLeafId: { 'leaf-1': 'pty-1' } }
    },
    ptyIdsByTabId: {}
  })
  let state = initial()
  const listeners = new Set<Listener>()
  return {
    inspect: vi.fn(async (): Promise<TerminalProcessInspection> => ({
      foregroundProcess: null,
      hasChildProcesses: false,
      foregroundProcessEvidence: {
        verdict: 'live',
        processName: null,
        fence: {
          platform: 'posix',
          shellPid: 100,
          shellStartTime: 'start',
          tty: '/dev/ttys001',
          foregroundPgid: 100
        },
        shellOwnsEveryTtyProcessGroup: true,
        authorityGeneration: 'gen',
        observationEpoch: 1,
        capturedAgeMs: 0,
        ptyId: 'pty-1',
        ptyIncarnationId: 'inc-1'
      }
    })),
    appStore: {
      getState: () => state,
      setState: (patch: State) => {
        const previous = state
        state = { ...state, ...patch }
        for (const listener of listeners) {
          listener(state, previous)
        }
      },
      subscribe: (listener: Listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      reset: () => {
        state = initial()
        listeners.clear()
      }
    }
  }
})

vi.mock('@/store', () => ({ useAppStore: mocks.appStore }))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  inspectRuntimeTerminalProcess: mocks.inspect
}))

const STORAGE_KEY = 'orca.run.sessionsByKey.v1'
const KEY = 'wt\u0000cmd'

function storeRun(status: string): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      {
        key: KEY,
        worktreeId: 'wt',
        commandKey: 'cmd',
        label: 'Dev Server',
        tabId: 'tab-1',
        leafId: 'leaf-1',
        attemptId: 'attempt-1',
        status,
        exitCode: null
      }
    ])
  )
}

async function start(): Promise<typeof RunSessionStoreModule> {
  const sessions = await import('./run-session-store')
  const { ensureRestoredRunVerification } = await import('./run-restore-verification')
  ensureRestoredRunVerification()
  return sessions
}

function bindPane(): void {
  mocks.appStore.setState({ ptyIdsByTabId: { 'tab-1': ['pty-1'] } })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  window.localStorage.clear()
  mocks.appStore.reset()
  mocks.inspect.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ensureRestoredRunVerification', () => {
  it('stops a restored run whose terminal came back with only a shell', async () => {
    storeRun('running')
    const { useRunSessionStore } = await start()

    bindPane()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(mocks.inspect).toHaveBeenCalledWith('pty-1')
    expect(useRunSessionStore.getState().sessionsByKey[KEY]?.status).toBe('stopped')
  })

  it('keeps a restored run whose terminal still runs its command', async () => {
    storeRun('running')
    mocks.inspect.mockResolvedValue({
      foregroundProcess: null,
      hasChildProcesses: true,
      foregroundProcessEvidence: {
        verdict: 'live',
        processName: null,
        fence: {
          platform: 'posix',
          shellPid: 100,
          shellStartTime: 'start',
          tty: '/dev/ttys001',
          foregroundPgid: 100
        },
        shellOwnsEveryTtyProcessGroup: false,
        authorityGeneration: 'gen',
        observationEpoch: 1,
        capturedAgeMs: 0,
        ptyId: 'pty-1',
        ptyIncarnationId: 'inc-1'
      }
    })
    const { useRunSessionStore } = await start()

    bindPane()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(useRunSessionStore.getState().sessionsByKey[KEY]?.status).toBe('running')
  })

  it('waits until this window has attached the run terminal', async () => {
    storeRun('running')
    await start()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.inspect).not.toHaveBeenCalled()

    bindPane()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.inspect).toHaveBeenCalled()
  })

  it('leaves alone runs that had already ended or were launched in this window', async () => {
    storeRun('succeeded')
    const { useRunSessionStore, runSessionKey } = await start()
    useRunSessionStore.getState().upsertSession({
      key: runSessionKey('wt', 'other'),
      worktreeId: 'wt',
      commandKey: 'other',
      label: 'Other',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      attemptId: 'attempt-2',
      status: 'running',
      exitCode: null
    })

    bindPane()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(mocks.inspect).not.toHaveBeenCalled()
  })
})
