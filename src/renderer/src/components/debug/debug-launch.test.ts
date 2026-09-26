import { describe, expect, it, vi } from 'vitest'

vi.mock('./debug-session-controller', () => ({ startPythonDebugSession: vi.fn() }))

import { isDebuggableFile, isLocalDebugTarget } from './debug-launch'

describe('isDebuggableFile', () => {
  it('accepts Python files only', () => {
    expect(isDebuggableFile('/p/app.py')).toBe(true)
    expect(isDebuggableFile('/p/APP.PY')).toBe(true)
    expect(isDebuggableFile('/p/app.ts')).toBe(false)
  })
})

describe('isLocalDebugTarget', () => {
  const local = { repoHostId: 'local', activeRuntimeIsLocal: true, worktreePath: '/Users/me/p' }

  it('accepts a local workspace', () => {
    expect(isLocalDebugTarget(local)).toBe(true)
  })

  it('rejects SSH workspaces', () => {
    expect(isLocalDebugTarget({ ...local, repoHostId: 'ssh:box' })).toBe(false)
  })

  it('rejects when the window is attached to a remote runtime', () => {
    expect(isLocalDebugTarget({ ...local, activeRuntimeIsLocal: false })).toBe(false)
  })

  it('rejects WSL workspaces opened through UNC paths', () => {
    expect(isLocalDebugTarget({ ...local, worktreePath: '\\\\wsl$\\Ubuntu\\home\\me\\p' })).toBe(
      false
    )
    expect(isLocalDebugTarget({ ...local, worktreePath: '//wsl.localhost/Ubuntu/home/me' })).toBe(
      false
    )
  })
})
