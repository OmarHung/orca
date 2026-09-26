// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_DEBUG_OUTPUT_ENTRIES, useDebugStore } from './debug-store'

beforeEach(() => {
  window.localStorage.clear()
  useDebugStore.setState({ session: null, output: [] })
})

describe('useDebugStore', () => {
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
      title: 'app.py',
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
