// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import {
  combineRunConfigurations,
  mergeImportedConfigurations,
  useRunConfigurationStore
} from './run-configuration-store'

const build: RunConfigurationDefinition = {
  type: 'command',
  id: 'b',
  name: 'Build',
  command: 'make'
}
const test: RunConfigurationDefinition = {
  type: 'command',
  id: 't',
  name: 'Test',
  command: 'make test'
}

beforeEach(() => {
  window.localStorage.clear()
  useRunConfigurationStore.setState({ localByRepo: {}, selectedByRepo: {}, sharedByWorktree: {} })
})

describe('useRunConfigurationStore', () => {
  it('persists local configurations and the selection per repo', () => {
    useRunConfigurationStore.getState().setLocal('repo1', [build, test])
    useRunConfigurationStore.getState().select('repo1', 't')
    const stored = JSON.parse(window.localStorage.getItem('orca.run.configurationsByRepo.v1') ?? '')
    expect(stored).toEqual({ repo1: { configurations: [build, test], selected: 't' } })
  })

  it('drops invalid stored entries when reading back', async () => {
    window.localStorage.setItem(
      'orca.run.configurationsByRepo.v1',
      JSON.stringify({ repo1: { configurations: [build, { name: 'bad' }], selected: 'b' }, x: 5 })
    )
    const { readStoredRunConfigurations } = await import('./run-configuration-store')
    expect(readStoredRunConfigurations()).toEqual({
      localByRepo: { repo1: [build] },
      selectedByRepo: { repo1: 'b' }
    })
  })
})

describe('mergeImportedConfigurations', () => {
  it('replaces entries with the same id and appends new ones', () => {
    const changed = { ...build, command: 'make all' }
    expect(mergeImportedConfigurations([build, test], [changed, { ...test, id: 'n' }])).toEqual({
      configurations: [changed, test, { ...test, id: 'n' }],
      added: 1,
      updated: 1
    })
  })
})

describe('combineRunConfigurations', () => {
  it('lists local first and hides shared entries a local one overrides', () => {
    const shared = [
      { ...build, name: 'Shared build' },
      { ...test, id: 's' }
    ]
    expect(
      combineRunConfigurations([build], shared).map((entry) => [
        entry.source,
        entry.configuration.id
      ])
    ).toEqual([
      ['local', 'b'],
      ['shared', 's']
    ])
  })
})
