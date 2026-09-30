// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  readStoredHiddenDetectedRuns,
  useDetectedRunVisibilityStore
} from './detected-run-visibility-store'

const STORAGE_KEY = 'orca.run.hiddenDetectedByRepo.v1'

beforeEach(() => {
  window.localStorage.clear()
  useDetectedRunVisibilityStore.setState({ hiddenByRepo: {} })
})

describe('useDetectedRunVisibilityStore', () => {
  it('hides once per key, shows again, and drops a repo with nothing hidden', () => {
    const { hide, show } = useDetectedRunVisibilityStore.getState()

    hide('repo', 'run:a')
    hide('repo', 'run:a')
    hide('repo', 'project:b')
    expect(useDetectedRunVisibilityStore.getState().hiddenByRepo).toEqual({
      repo: ['run:a', 'project:b']
    })
    expect(readStoredHiddenDetectedRuns()).toEqual({ repo: ['run:a', 'project:b'] })

    show('repo', ['run:a', 'project:b'])
    expect(useDetectedRunVisibilityStore.getState().hiddenByRepo).toEqual({})
    expect(readStoredHiddenDetectedRuns()).toEqual({})
  })
})

describe('readStoredHiddenDetectedRuns', () => {
  it('keeps only string keys and ignores unreadable storage', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ repo: ['run:a', 3, null], other: 'nope', empty: [] })
    )
    expect(readStoredHiddenDetectedRuns()).toEqual({ repo: ['run:a'] })

    window.localStorage.setItem(STORAGE_KEY, '{not json')
    expect(readStoredHiddenDetectedRuns()).toEqual({})
  })
})
