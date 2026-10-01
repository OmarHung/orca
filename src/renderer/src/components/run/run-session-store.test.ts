// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  finishRunSession,
  gentlestStopStage,
  isRunPanelTerminalTab,
  readStoredRunSessions,
  runSessionKey,
  runStopStage,
  useRunSessionStore,
  type RunSession
} from './run-session-store'

const STORAGE_KEY = 'orca.run.sessionsByKey.v1'

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

describe('stored run sessions', () => {
  const target = {
    worktreeId: 'wt',
    groupId: null,
    commandKey: 'cmd',
    command: { id: 'cmd', label: 'Dev Server', command: 'pnpm dev', appendEnter: true }
  }

  it('keeps runs across a restart, with their Rerun target', () => {
    useRunSessionStore
      .getState()
      .upsertSession(session({ status: 'succeeded', exitCode: 0, target }))

    expect(readStoredRunSessions()[session().key]).toEqual(
      session({ status: 'succeeded', exitCode: 0, target })
    )
  })

  it('restarts the Stop ladder of a run that was active, since it may have ended meanwhile', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        session({ commandKey: 'a', status: 'stopping', forceStopped: true }),
        session({ commandKey: 'b', status: 'queued' }),
        session({ commandKey: 'c', status: 'unverifiable' })
      ])
    )

    const stored = readStoredRunSessions()

    expect(stored[runSessionKey('wt', 'a')]).toMatchObject({ status: 'running' })
    expect(stored[runSessionKey('wt', 'a')]?.forceStopped).toBeUndefined()
    expect(stored[runSessionKey('wt', 'b')]?.status).toBe('running')
    expect(stored[runSessionKey('wt', 'c')]?.status).toBe('unverifiable')
  })

  it('drops malformed entries and unreadable storage', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ ...session(), status: 'exploded' }, { ...session(), tabId: 7 }, null])
    )
    expect(readStoredRunSessions()).toEqual({})

    window.localStorage.setItem(STORAGE_KEY, '{not json')
    expect(readStoredRunSessions()).toEqual({})
  })

  it('removes a run and prunes runs whose terminal is gone', () => {
    const store = useRunSessionStore.getState()
    store.upsertSession(session())
    store.upsertSession(
      session({ commandKey: 'other', key: runSessionKey('wt', 'other'), tabId: 'tab-2' })
    )
    expect(isRunPanelTerminalTab('tab-2')).toBe(true)

    store.retainSessions((candidate) => candidate.tabId !== 'tab-2')
    expect(isRunPanelTerminalTab('tab-2')).toBe(false)

    store.removeSession(session().key)
    expect(useRunSessionStore.getState().sessionsByKey).toEqual({})
    expect(readStoredRunSessions()).toEqual({})
  })
})
