// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_DEBUG_OUTPUT_ENTRIES, toggleLine, useDebugStore } from './debug-store'

beforeEach(() => {
  window.localStorage.clear()
  useDebugStore.setState({ breakpointsByFile: {}, session: null, output: [] })
})

describe('toggleLine', () => {
  it('adds a line in sorted order', () => {
    expect(toggleLine([3, 10], 5)).toEqual([3, 5, 10])
  })

  it('removes an existing line', () => {
    expect(toggleLine([3, 5, 10], 5)).toEqual([3, 10])
  })
})

describe('useDebugStore', () => {
  it('toggles breakpoints per file and persists them', () => {
    useDebugStore.getState().toggleBreakpoint('/p/app.py', 4)
    useDebugStore.getState().toggleBreakpoint('/p/app.py', 2)

    expect(useDebugStore.getState().breakpointsByFile).toEqual({ '/p/app.py': [2, 4] })
    expect(JSON.parse(window.localStorage.getItem('orca.debug.breakpoints.v1') ?? '{}')).toEqual({
      '/p/app.py': [2, 4]
    })
  })

  it('drops the file entry when its last breakpoint is removed', () => {
    useDebugStore.getState().toggleBreakpoint('/p/app.py', 4)
    useDebugStore.getState().toggleBreakpoint('/p/app.py', 4)

    expect(useDebugStore.getState().breakpointsByFile).toEqual({})
  })

  it('caps console output', () => {
    for (let index = 0; index < MAX_DEBUG_OUTPUT_ENTRIES + 5; index++) {
      useDebugStore.getState().appendOutput('stdout', `line ${index}`)
    }

    const output = useDebugStore.getState().output
    expect(output).toHaveLength(MAX_DEBUG_OUTPUT_ENTRIES)
    expect(output.at(-1)?.text).toBe(`line ${MAX_DEBUG_OUTPUT_ENTRIES + 4}`)
  })

  it('starting a new session clears the previous paused state and output', () => {
    useDebugStore.getState().appendOutput('stdout', 'old')
    useDebugStore.getState().setPausedState({
      frames: [{ id: 1, name: 'f', line: 1, column: 1 }],
      selectedFrameId: 1,
      scopes: [],
      executionLocation: { path: '/p/app.py', line: 1 }
    })

    useDebugStore.getState().setSession({
      id: 's2',
      worktreeId: 'w',
      filePath: '/p/app.py',
      phase: 'starting',
      stoppedThreadId: null,
      stopReason: null
    })

    const state = useDebugStore.getState()
    expect(state.output).toEqual([])
    expect(state.frames).toEqual([])
    expect(state.executionLocation).toBeNull()
  })
})
