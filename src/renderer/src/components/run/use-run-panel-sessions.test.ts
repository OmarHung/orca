import { describe, expect, it } from 'vitest'
import type { RunSession } from './run-session-store'
import { selectedRunPanelSession } from './use-run-panel-sessions'

function session(commandKey: string): RunSession {
  return {
    key: `wt\u0000${commandKey}`,
    worktreeId: 'wt',
    commandKey,
    label: commandKey,
    tabId: `tab-${commandKey}`,
    leafId: `leaf-${commandKey}`,
    attemptId: 'attempt',
    status: 'running',
    exitCode: null
  }
}

describe('selectedRunPanelSession', () => {
  const sessions = [session('build'), session('serve')]

  it('shows the picked run', () => {
    expect(selectedRunPanelSession(sessions, 'build')?.commandKey).toBe('build')
  })

  it('falls back to the newest run when nothing or a closed run was picked', () => {
    expect(selectedRunPanelSession(sessions, undefined)?.commandKey).toBe('serve')
    expect(selectedRunPanelSession(sessions, 'gone')?.commandKey).toBe('serve')
    expect(selectedRunPanelSession([], 'build')).toBeNull()
  })
})
