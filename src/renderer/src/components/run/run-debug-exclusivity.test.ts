import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunSession } from './run-session-store'
import type { RunTarget } from './run-configuration-control'

const { stopDebugSession, liveRunSession, stopConfigurationAndWait } = vi.hoisted(() => ({
  stopDebugSession: vi.fn(async () => {}),
  liveRunSession: vi.fn((): RunSession | null => null),
  stopConfigurationAndWait: vi.fn(async () => {})
}))
vi.mock('../debug/debug-session-controller', () => ({ stopDebugSession }))
vi.mock('./run-configuration-control', () => ({
  liveRunSession,
  stopConfigurationAndWait
}))

import { useDebugStore } from '../debug/debug-store'
import { stopDebuggingBeforeRun, stopRunBeforeDebug } from './run-debug-exclusivity'

const target: RunTarget = {
  worktreeId: 'wt',
  groupId: null,
  commandKey: 'detected:web',
  command: {
    id: 'detected:web',
    label: 'web: dev',
    command: 'pnpm dev',
    appendEnter: true
  }
}

function context(confirmed: boolean) {
  return {
    worktreeId: 'wt',
    sourceKey: 'recent:detected:web',
    label: 'web: dev',
    confirm: vi.fn(async () => confirmed)
  }
}

function debugSession(sourceKey: string, phase: 'running' | 'ended' = 'running', id = 's1'): void {
  useDebugStore.getState().addSession({
    id,
    worktreeId: 'wt',
    title: 'web: dev',
    sourceKey,
    identity: sourceKey,
    adapterId: 'pwa-node',
    rootPath: '/wt'
  })
  useDebugStore.getState().updateSession(id, { phase })
}

function runSession(status: RunSession['status']): RunSession {
  return {
    key: 'wt::detected:web',
    worktreeId: 'wt',
    commandKey: 'detected:web',
    label: 'web: dev',
    tabId: 'tab-1',
    leafId: 'leaf-1',
    attemptId: 'attempt-1',
    status,
    exitCode: null
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useDebugStore.setState({ sessions: [], outputBySession: {}, selectedByWorktree: {} })
})

describe('stopDebuggingBeforeRun', () => {
  it('runs without asking when the item is not being debugged', async () => {
    debugSession('recent:detected:other')
    const ctx = context(true)

    await expect(stopDebuggingBeforeRun(ctx)).resolves.toBe(true)
    expect(ctx.confirm).not.toHaveBeenCalled()
  })

  it('ignores a debug session that already ended', async () => {
    debugSession('recent:detected:web', 'ended')
    const ctx = context(true)

    await expect(stopDebuggingBeforeRun(ctx)).resolves.toBe(true)
    expect(ctx.confirm).not.toHaveBeenCalled()
  })

  it('stops every session debugging the same item once the user confirms', async () => {
    debugSession('recent:detected:web')
    debugSession('recent:detected:web', 'running', 's2')
    debugSession('recent:detected:other', 'running', 's3')

    await expect(stopDebuggingBeforeRun(context(true))).resolves.toBe(true)
    expect(stopDebugSession.mock.calls).toEqual([['s1'], ['s2']])
  })

  it('keeps the debug session when the user cancels', async () => {
    debugSession('recent:detected:web')

    await expect(stopDebuggingBeforeRun(context(false))).resolves.toBe(false)
    expect(stopDebugSession).not.toHaveBeenCalled()
  })
})

describe('stopRunBeforeDebug', () => {
  it('debugs without asking when the item is not running', async () => {
    liveRunSession.mockReturnValue(runSession('succeeded'))
    const ctx = context(true)

    await expect(stopRunBeforeDebug(ctx, target)).resolves.toBe(true)
    expect(ctx.confirm).not.toHaveBeenCalled()
  })

  it('stops the running item and waits once the user confirms', async () => {
    liveRunSession.mockReturnValue(runSession('running'))

    await expect(stopRunBeforeDebug(context(true), target)).resolves.toBe(true)
    expect(stopConfigurationAndWait).toHaveBeenCalledWith(target)
  })

  it('keeps the run when the user cancels', async () => {
    liveRunSession.mockReturnValue(runSession('running'))

    await expect(stopRunBeforeDebug(context(false), target)).resolves.toBe(false)
    expect(stopConfigurationAndWait).not.toHaveBeenCalled()
  })
})
