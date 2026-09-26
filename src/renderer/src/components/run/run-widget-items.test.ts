import { describe, expect, it } from 'vitest'
import { runWidgetItemForRun, runWidgetItems, selectedRunWidgetItem } from './run-widget-items'
import type { RunTarget } from './run-configuration-control'

const recentRun: RunTarget = {
  worktreeId: 'wt',
  groupId: null,
  commandKey: 'detected:api',
  command: { id: 'detected:api', label: 'Api: https', command: 'dotnet run', appendEnter: true }
}
const items = runWidgetItems({
  recent: [recentRun],
  configurations: [
    { source: 'local', configuration: { type: 'command', id: 'b', name: 'Build', command: 'make' } }
  ],
  quickCommands: [
    {
      key: 'local:q1',
      hostId: 'local',
      hostLabel: 'This Mac',
      command: { id: 'q1', label: 'Lint', command: 'pnpm lint', appendEnter: true }
    }
  ]
})

describe('runWidgetItems', () => {
  it('lists the temporary run, then configurations, then quick commands', () => {
    expect(items.map((item) => [item.kind, item.key, item.label])).toEqual([
      ['recent', 'recent:detected:api', 'Api: https'],
      ['configuration', 'config:b', 'Build'],
      ['quick-command', 'quick:local:q1', 'Lint']
    ])
  })
})

describe('selectedRunWidgetItem', () => {
  it('finds the stored key, accepts older saved keys, and falls back to the first', () => {
    expect(selectedRunWidgetItem(items, 'detected')?.label).toBe('Api: https')
    expect(selectedRunWidgetItem(items, 'quick:local:q1')?.label).toBe('Lint')
    expect(selectedRunWidgetItem(items, 'b')?.label).toBe('Build')
    expect(selectedRunWidgetItem(items, 'gone')?.label).toBe('Api: https')
    expect(selectedRunWidgetItem([], undefined)).toBeNull()
  })
})

describe('runWidgetItemForRun', () => {
  it('maps the run that owns a terminal back to its item', () => {
    expect(runWidgetItemForRun(items, 'detected:api')?.label).toBe('Api: https')
    expect(runWidgetItemForRun(items, 'config:b')?.label).toBe('Build')
    expect(runWidgetItemForRun(items, 'local:q1')?.label).toBe('Lint')
    expect(runWidgetItemForRun(items, 'unknown')).toBeNull()
  })
})
