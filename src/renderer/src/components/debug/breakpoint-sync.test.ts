// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('monaco-editor', () => ({
  Range: class {},
  editor: { TrackedRangeStickiness: {}, MouseTargetType: {} }
}))

import { useBreakpointStore } from './breakpoint-store'
import { useDebugStore } from './debug-store'
import {
  adapterIdForTarget,
  applyBreakpointEvent,
  breakpointsForRequest,
  readVerified,
  verifiedLinesForFile
} from './breakpoint-sync'
import { breakpointGlyphClass } from './use-monaco-debug-decorations'

beforeEach(() => {
  window.localStorage.clear()
  useBreakpointStore.setState({ breakpointsByFile: {} })
  useDebugStore.setState({ sessions: [], outputBySession: {}, selectedByWorktree: {} })
})

function addSession(id: string, adapterId: string): void {
  useDebugStore.getState().addSession({
    id,
    worktreeId: 'w',
    title: id,
    identity: id,
    adapterId,
    rootPath: '/p'
  })
  useDebugStore.getState().updateSession(id, { phase: 'running' })
}

describe('adapterIdForTarget', () => {
  it('maps every launch target to its adapter', () => {
    expect(adapterIdForTarget({ kind: 'python-file', filePath: '/p/a.py' })).toBe('debugpy')
    expect(adapterIdForTarget({ kind: 'node-file', filePath: '/p/a.js' })).toBe('pwa-node')
    expect(adapterIdForTarget({ kind: 'node-script', packageManager: 'npm', script: 'dev' })).toBe(
      'pwa-node'
    )
    expect(adapterIdForTarget({ kind: 'dotnet-project', projectFile: '/p/A.csproj' })).toBe(
      'coreclr'
    )
  })
})

describe('breakpointsForRequest', () => {
  it("sends the workspace's enabled breakpoints in the adapter's language", () => {
    useBreakpointStore.setState({
      breakpointsByFile: {
        '/p/a.py': [
          { line: 2, enabled: true, condition: 'i == 3' },
          { line: 5, enabled: false }
        ],
        '/p/web/app.ts': [{ line: 1, enabled: true }],
        '/elsewhere/b.py': [{ line: 1, enabled: true }]
      }
    })

    expect(breakpointsForRequest({ rootPath: '/p', adapterId: 'debugpy' })).toEqual({
      '/p/a.py': [{ line: 2, condition: 'i == 3' }]
    })
  })
})

describe('readVerified', () => {
  it('pairs the adapter answer with the lines that were sent, in order', () => {
    expect(
      readVerified({ breakpoints: [{ verified: true }, { verified: false }] }, [3, 9])
    ).toEqual({ 3: true, 9: false })
    expect(readVerified(undefined, [3])).toEqual({})
  })
})

describe('applyBreakpointEvent', () => {
  it('records a breakpoint the adapter bound after the fact, for that session', () => {
    addSession('node', 'pwa-node')
    applyBreakpointEvent('node', {
      reason: 'changed',
      breakpoint: { verified: true, line: 4, source: { path: '/p/a.js' } }
    })

    expect(useDebugStore.getState().sessions[0].verifiedByFile).toEqual({ '/p/a.js': { 4: true } })
  })
})

describe('verifiedLinesForFile', () => {
  it('asks only the running sessions that take the file', () => {
    addSession('api', 'pwa-node')
    addSession('web', 'pwa-node')
    addSession('py', 'debugpy')
    useDebugStore.getState().setVerified('api', '/p/web/app.ts', { 3: false })
    useDebugStore.getState().setVerified('web', '/p/web/app.ts', { 3: true })
    useDebugStore.getState().setVerified('py', '/p/web/app.ts', { 9: false })

    const { sessions } = useDebugStore.getState()
    expect(verifiedLinesForFile(sessions, '/p/web/app.ts')).toEqual({ 3: true })
    useDebugStore.getState().updateSession('web', { phase: 'ended' })
    expect(verifiedLinesForFile(useDebugStore.getState().sessions, '/p/web/app.ts')).toEqual({
      3: false
    })
  })
})

describe('breakpointGlyphClass', () => {
  it('shows condition, logpoint, disabled and unbound states', () => {
    expect(breakpointGlyphClass({ line: 1, enabled: true }, undefined)).toBe(
      'orca-debug-breakpoint'
    )
    expect(breakpointGlyphClass({ line: 1, enabled: true, condition: 'x' }, true)).toContain(
      'orca-debug-breakpoint-conditional'
    )
    expect(breakpointGlyphClass({ line: 1, enabled: true, logMessage: 'hi' }, true)).toBe(
      'orca-debug-logpoint'
    )
    expect(breakpointGlyphClass({ line: 1, enabled: false }, true)).toContain(
      'orca-debug-breakpoint-disabled'
    )
    expect(breakpointGlyphClass({ line: 1, enabled: true }, false)).toContain(
      'orca-debug-breakpoint-unverified'
    )
  })
})
