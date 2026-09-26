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

function debugSession(sourceKey: string, phase: 'running' | 'ended' = 'running'): void {
  useDebugStore.getState().setSession({
    id: 's1',
    worktreeId: 'wt',
    title: 'web: dev',
    sourceKey,
    phase,
    stoppedThreadId: null,
    stopReason: null
  })
}

function runSession(status: RunSession['status']): RunSession {
  return {
    key: 'wt::detected:web',
    worktreeId: 'wt',
    commandKey: 'detected:web',
    label: 'web: dev',
    tabId: 'tab-1',
    status,
    exitCode: null
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useDebugStore.getState().setSession(null)
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

  it('stops debugging the same item once the user confirms', async () => {
    debugSession('recent:detected:web')

    await expect(stopDebuggingBeforeRun(context(true))).resolves.toBe(true)
    expect(stopDebugSession).toHaveBeenCalledTimes(1)
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
