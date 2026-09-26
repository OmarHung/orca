// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  finishRunSession,
  runSessionKey,
  useRunSessionStore,
  type RunSession
} from './run-session-store'

function session(overrides: Partial<RunSession> = {}): RunSession {
  return {
    key: runSessionKey('wt', 'cmd'),
    worktreeId: 'wt',
    commandKey: 'cmd',
    label: 'Dev Server',
    tabId: 'tab-1',
    status: 'running',
    exitCode: null,
    ...overrides
  }
}

beforeEach(() => {
  window.localStorage.clear()
  useRunSessionStore.setState({ sessionsByKey: {} })
})

describe('finishRunSession', () => {
  it('maps exit codes to succeeded, failed, or finished', () => {
    expect(finishRunSession(session(), 0).status).toBe('succeeded')
    expect(finishRunSession(session(), 2)).toMatchObject({ status: 'failed', exitCode: 2 })
    expect(finishRunSession(session(), null).status).toBe('finished')
  })

  it('reports a run the user stopped as stopped, whatever the exit code', () => {
    expect(finishRunSession(session({ status: 'stopping' }), 130).status).toBe('stopped')
  })

  it('ignores a finish for a run that already ended', () => {
    const ended = session({ status: 'succeeded', exitCode: 0 })
    expect(finishRunSession(ended, 1)).toBe(ended)
  })
})

describe('useRunSessionStore', () => {
  it('finishes the active run that owns the tab', () => {
    useRunSessionStore.getState().upsertSession(session())

    const finished = useRunSessionStore.getState().finishByTab('tab-1', 0)

    expect(finished?.status).toBe('succeeded')
    expect(useRunSessionStore.getState().sessionsByKey[session().key].status).toBe('succeeded')
  })

  it('ignores command finishes in tabs that are not running a configuration', () => {
    useRunSessionStore.getState().upsertSession(session({ status: 'succeeded' }))

    expect(useRunSessionStore.getState().finishByTab('tab-1', 1)).toBeNull()
    expect(useRunSessionStore.getState().finishByTab('other-tab', 1)).toBeNull()
  })
})
