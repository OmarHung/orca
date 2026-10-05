import { describe, expect, it } from 'vitest'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import type { RunTarget } from './run-target'
import { runTargetMode, runWidgetItemMode } from './run-mode'
import type { RunWidgetItem } from './run-widget-items'

function target(extra: Partial<RunTarget> = {}): RunTarget {
  return {
    worktreeId: 'wt',
    groupId: null,
    commandKey: 'detected:api',
    command: {
      id: 'detected:api',
      label: 'Api: build',
      command: 'dotnet build',
      appendEnter: true
    },
    ...extra
  }
}

const detected: DetectedRunConfiguration = {
  id: 'api',
  ecosystem: 'dotnet',
  projectName: 'Api',
  projectDir: '/repo/api',
  kind: 'build',
  name: 'build',
  command: 'dotnet build'
}

describe('runTargetMode', () => {
  it('shows builds, tests and publishes as such and anything else as a plain run', () => {
    expect(runTargetMode(target({ kind: 'build' }))).toBe('build')
    expect(runTargetMode(target({ kind: 'test' }))).toBe('test')
    expect(runTargetMode(target({ kind: 'publish' }))).toBe('publish')
    expect(runTargetMode(target({ kind: 'other' }))).toBe('run')
    expect(runTargetMode(target())).toBe('run')
    expect(runTargetMode(null)).toBe('run')
  })
})

describe('runWidgetItemMode', () => {
  it('follows the run the item starts', () => {
    const items: RunWidgetItem[] = [
      {
        kind: 'detected',
        key: 'recent:detected:api',
        label: 'Api: build',
        configuration: detected,
        target: target({ kind: 'build' })
      },
      { kind: 'recent', key: 'recent:x', label: 'x', target: target({ kind: 'test' }) },
      {
        kind: 'configuration',
        key: 'config:ship',
        label: 'Ship',
        source: 'local',
        configuration: { type: 'dotnet-publish', id: 'ship', name: 'Ship', projectFile: 'a.csproj' }
      },
      {
        kind: 'configuration',
        key: 'config:web',
        label: 'Web',
        source: 'local',
        configuration: { type: 'command', id: 'web', name: 'Web', command: 'pnpm dev' }
      }
    ]

    expect(items.map(runWidgetItemMode)).toEqual(['build', 'test', 'publish', 'run'])
  })
})
