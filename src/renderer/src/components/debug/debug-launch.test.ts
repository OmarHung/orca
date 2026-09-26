import { describe, expect, it, vi } from 'vitest'

vi.mock('./debug-session-controller', () => ({ startDebugSession: vi.fn() }))

import { debugTargetForFile, isDebuggableFile, isLocalDebugTarget } from './debug-launch'

describe('debugTargetForFile', () => {
  it('debugs Python with debugpy and JavaScript/TypeScript with js-debug', () => {
    expect(debugTargetForFile('/p/app.py', '/p/.venv/bin/python')).toEqual({
      kind: 'python-file',
      filePath: '/p/app.py',
      pythonPath: '/p/.venv/bin/python'
    })
    expect(debugTargetForFile('/p/server.TS')).toEqual({
      kind: 'node-file',
      filePath: '/p/server.TS'
    })
    expect(debugTargetForFile('/p/tool.mjs')?.kind).toBe('node-file')
  })

  it('has nothing for other files, including type declarations', () => {
    expect(debugTargetForFile('/p/types.d.ts')).toBeNull()
    expect(debugTargetForFile('/p/README.md')).toBeNull()
    expect(isDebuggableFile('/p/main.go')).toBe(false)
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
