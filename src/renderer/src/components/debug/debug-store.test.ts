// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  debugOutput,
  MAX_DEBUG_OUTPUT_ENTRIES,
  pausedDebugSessionForFile,
  selectedDebugSession,
  useDebugStore,
  type NewDebugSession
} from './debug-store'

function session(id: string, worktreeId = 'w'): NewDebugSession {
  return {
    id,
    worktreeId,
    title: `${id}.py`,
    identity: id,
    adapterId: 'debugpy',
    rootPath: '/repo'
  }
}

function pause(id: string, path: string): void {
  useDebugStore.getState().updateSession(id, { stoppedThreadId: 1 })
  useDebugStore.getState().setPausedState(id, {
    frames: [{ id: 1, name: 'f', line: 3, column: 1 }],
    selectedFrameId: 1,
    scopes: [],
    executionLocation: { path, line: 3 }
  })
}

beforeEach(() => {
  useDebugStore.setState({ sessions: [], outputBySession: {}, selectedByWorktree: {} })
})

describe('useDebugStore', () => {
  it('caps each session console separately', () => {
    useDebugStore.getState().addSession(session('a'))
    useDebugStore.getState().addSession(session('b'))
    for (let index = 0; index < MAX_DEBUG_OUTPUT_ENTRIES + 5; index++) {
      useDebugStore.getState().appendOutput('a', 'stdout', `line ${index}`)
    }
    useDebugStore.getState().appendOutput('b', 'stdout', 'other')

    const output = debugOutput(useDebugStore.getState(), 'a')
    expect(output).toHaveLength(MAX_DEBUG_OUTPUT_ENTRIES)
    expect(output.at(-1)?.text).toBe(`line ${MAX_DEBUG_OUTPUT_ENTRIES + 4}`)
    expect(debugOutput(useDebugStore.getState(), 'b').map((entry) => entry.text)).toEqual(['other'])
  })

  it('shows the newest session of a worktree until another tab is chosen', () => {
    useDebugStore.getState().addSession(session('a'))
    useDebugStore.getState().addSession(session('b'))
    useDebugStore.getState().addSession(session('other', 'w2'))

    expect(selectedDebugSession(useDebugStore.getState(), 'w')?.id).toBe('b')
    useDebugStore.getState().selectSession('w', 'a')
    expect(selectedDebugSession(useDebugStore.getState(), 'w')?.id).toBe('a')
    useDebugStore.getState().removeSession('a')
    expect(selectedDebugSession(useDebugStore.getState(), 'w')?.id).toBe('b')
  })

  it('keeps each session paused in its own place', () => {
    useDebugStore.getState().addSession(session('api'))
    useDebugStore.getState().addSession(session('web'))
    pause('api', '/repo/api.py')
    pause('web', '/repo/web.py')

    const { sessions } = useDebugStore.getState()
    expect(pausedDebugSessionForFile(sessions, '/repo/api.py')?.id).toBe('api')
    expect(pausedDebugSessionForFile(sessions, '/repo/web.py')?.id).toBe('web')
    expect(pausedDebugSessionForFile(sessions, '/repo/other.py')).toBeNull()
  })
})
