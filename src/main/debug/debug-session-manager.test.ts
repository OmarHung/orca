import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DebugSessionEvent } from '../../shared/debug/debug-session-types'
import type { PreparedDebugAdapter } from './adapters/prepared-debug-adapter'

const { prepareJsDebug, startDebugSession, breakpointsToAdapter } = vi.hoisted(() => ({
  prepareJsDebug: vi.fn(),
  startDebugSession: vi.fn(),
  breakpointsToAdapter: vi.fn(async (byPath: unknown) => byPath)
}))
vi.mock('./adapters/js-debug-launch', () => ({ prepareJsDebug }))
vi.mock('./adapters/debugpy-launch', () => ({ prepareDebugpy: vi.fn() }))
vi.mock('./adapters/netcoredbg-launch', () => ({ prepareNetcoredbg: vi.fn() }))
vi.mock('./debug-session', () => ({ startDebugSession }))
vi.mock('./debug-path-mapping', () => ({
  DebugPathMapping: class {
    breakpointsToAdapter = breakpointsToAdapter
  }
}))

import { DebugSessionManager } from './debug-session-manager'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function fakeAdapter(dispose: () => void): PreparedDebugAdapter {
  return {
    adapterId: 'pwa-node',
    transport: { write: vi.fn(), onData: vi.fn(), onClose: vi.fn(), close: vi.fn() },
    launchArguments: {},
    diagnostics: () => '',
    dispose
  }
}

const REQUEST = {
  worktreeId: 'wt',
  cwd: '/w',
  breakpoints: {},
  target: { kind: 'node-file' as const, filePath: '/w/a.js' }
}

describe('DebugSessionManager.stop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cancels a session stopped while its breakpoints are still being mapped', async () => {
    prepareJsDebug.mockResolvedValue(fakeAdapter(vi.fn()))
    const mapping = deferred<Record<string, unknown>>()
    breakpointsToAdapter.mockReturnValueOnce(mapping.promise)
    const events: DebugSessionEvent[] = []
    const manager = new DebugSessionManager('/adapters')

    const started = manager.start('s2', REQUEST, { send: (event) => events.push(event) })
    await vi.waitFor(() => expect(breakpointsToAdapter).toHaveBeenCalled())
    await manager.stop('s2')
    mapping.resolve({})

    await expect(started).resolves.toMatchObject({ ok: false })
    expect(startDebugSession).not.toHaveBeenCalled()
    expect(events).toContainEqual({ kind: 'phase', sessionId: 's2', phase: 'ended' })
  })

  it('reports a stop during adapter preparation at once and never launches the program', async () => {
    const adapter = deferred<PreparedDebugAdapter>()
    let onInstalling: (() => void) | undefined
    prepareJsDebug.mockImplementation((context: { onInstalling: () => void }) => {
      onInstalling = context.onInstalling
      return adapter.promise
    })
    const events: DebugSessionEvent[] = []
    const manager = new DebugSessionManager('/adapters')
    const ended = { kind: 'phase', sessionId: 's1', phase: 'ended' }

    const started = manager.start('s1', REQUEST, { send: (event) => events.push(event) })
    await vi.waitFor(() => expect(prepareJsDebug).toHaveBeenCalled())
    await manager.stop('s1')
    // The download may take a while; the stop must not wait for it.
    expect(events).toEqual([ended])

    onInstalling?.()
    const dispose = vi.fn()
    adapter.resolve(fakeAdapter(dispose))

    await expect(started).resolves.toMatchObject({ ok: false })
    expect(startDebugSession).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(events).toEqual([ended])
  })
})
