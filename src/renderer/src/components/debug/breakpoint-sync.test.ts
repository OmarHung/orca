// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('monaco-editor', () => ({
  Range: class {},
  editor: { TrackedRangeStickiness: {}, MouseTargetType: {} }
}))

import { useBreakpointStore } from './breakpoint-store'
import {
  adapterIdForTarget,
  applyBreakpointEvent,
  breakpointsForRequest,
  readVerified
} from './breakpoint-sync'
import { breakpointGlyphClass } from './use-monaco-debug-decorations'

beforeEach(() => {
  window.localStorage.clear()
  useBreakpointStore.setState({ breakpointsByFile: {}, verifiedByFile: {} })
})

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
  it('sends enabled breakpoints with their conditions', () => {
    useBreakpointStore.setState({
      breakpointsByFile: {
        '/p/a.py': [
          { line: 2, enabled: true, condition: 'i == 3' },
          { line: 5, enabled: false }
        ]
      }
    })

    expect(breakpointsForRequest()).toEqual({ '/p/a.py': [{ line: 2, condition: 'i == 3' }] })
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
  it('records a breakpoint the adapter bound after the fact', () => {
    applyBreakpointEvent({
      reason: 'changed',
      breakpoint: { verified: true, line: 4, source: { path: '/p/a.js' } }
    })

    expect(useBreakpointStore.getState().verifiedByFile).toEqual({ '/p/a.js': { 4: true } })
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
