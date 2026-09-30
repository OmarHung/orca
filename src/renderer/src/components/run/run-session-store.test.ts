// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  finishRunSession,
  gentlestStopStage,
  runSessionKey,
  runStopStage,
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
    leafId: 'leaf-1',
    attemptId: 'attempt-1',
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
  it('finishes the active run that owns the pane', () => {
    useRunSessionStore.getState().upsertSession(session())

    const finished = useRunSessionStore.getState().finishByLeafId('leaf-1', 0)

    expect(finished?.status).toBe('succeeded')
    expect(useRunSessionStore.getState().sessionsByKey[session().key].status).toBe('succeeded')
  })

  it('ignores command finishes in panes that are not running a configuration', () => {
    useRunSessionStore.getState().upsertSession(session({ status: 'succeeded' }))

    expect(useRunSessionStore.getState().finishByLeafId('leaf-1', 1)).toBeNull()
    expect(useRunSessionStore.getState().finishByLeafId('other-leaf', 1)).toBeNull()
  })

  it('does not let an older attempt update its replacement', () => {
    useRunSessionStore.getState().upsertSession(session({ attemptId: 'attempt-2' }))

    useRunSessionStore.getState().setStatus(session().key, 'attempt-1', 'stopping')

    expect(useRunSessionStore.getState().sessionsByKey[session().key].status).toBe('running')
  })

  it('does not let a late stop acknowledgement overwrite a completed run', () => {
    useRunSessionStore.getState().upsertSession(session({ status: 'succeeded', exitCode: 0 }))

    useRunSessionStore.getState().setStatus(session().key, session().attemptId, 'unverifiable')

    expect(useRunSessionStore.getState().sessionsByKey[session().key]).toMatchObject({
      status: 'succeeded',
      exitCode: 0
    })
  })
})

describe('runStopStage', () => {
  it('interrupts a running run, forces a stopping one, and closes one already forced', () => {
    expect(runStopStage(session())).toBe('interrupt')
    expect(runStopStage(session({ status: 'stopping' }))).toBe('force')
    expect(runStopStage(session({ status: 'stopping', forceStopped: true }))).toBe('close')
  })

  it('picks the gentlest step among several runs', () => {
    expect(gentlestStopStage(['close', 'force'])).toBe('force')
    expect(gentlestStopStage(['close', 'interrupt', 'force'])).toBe('interrupt')
    expect(gentlestStopStage([])).toBeNull()
  })

  it('remembers that Stop has forced a run', () => {
    useRunSessionStore.getState().upsertSession(session({ status: 'stopping' }))
    useRunSessionStore.getState().markForceStopped(session().key, session().attemptId)
    expect(useRunSessionStore.getState().sessionsByKey[session().key].forceStopped).toBe(true)
  })
})
