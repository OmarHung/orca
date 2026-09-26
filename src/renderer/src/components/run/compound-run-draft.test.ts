import { describe, expect, it } from 'vitest'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import {
  detectedCommandConfiguration,
  newSequentialCompound,
  unsavedDetectedRuns,
  withoutUnusedCreated
} from './compound-run-draft'

function detected(projectDir: string, name: string, command: string): DetectedRunConfiguration {
  return {
    id: `node:${projectDir}:script:${name}`,
    ecosystem: 'node',
    projectName: projectDir.split('/').pop() ?? '',
    projectDir,
    kind: 'run',
    name,
    command
  }
}

describe('detectedCommandConfiguration', () => {
  it('creates a workspace-relative command configuration for a detected run', () => {
    expect(
      detectedCommandConfiguration(detected('/w/web', 'dev', 'pnpm run dev'), [], '/w', () => 'n1')
    ).toEqual({
      id: 'n1',
      created: {
        type: 'command',
        id: 'n1',
        name: 'web: dev',
        command: 'pnpm run dev',
        cwd: 'web'
      }
    })
    expect(
      detectedCommandConfiguration(detected('/w', 'lint', 'npm run lint'), [], '/w', () => 'n2')
        .created
    ).toEqual({
      type: 'command',
      id: 'n2',
      name: 'w: lint',
      command: 'npm run lint'
    })
  })

  it('reuses an identical saved command', () => {
    const saved = [
      {
        type: 'command' as const,
        id: 'keep',
        name: 'Web',
        command: 'pnpm run dev',
        cwd: 'web'
      }
    ]
    expect(
      detectedCommandConfiguration(
        detected('/w/web', 'dev', 'pnpm run dev'),
        saved,
        '/w',
        () => 'x'
      )
    ).toEqual({ id: 'keep' })
  })
})

describe('withoutUnusedCreated', () => {
  it('keeps created configurations only while the compound references them', () => {
    const compound = { ...newSequentialCompound('c'), configurations: ['a'] }
    const configurations = [
      { type: 'command' as const, id: 'a', name: 'A', command: 'a' },
      { type: 'command' as const, id: 'b', name: 'B', command: 'b' },
      { type: 'command' as const, id: 'old', name: 'Old', command: 'o' }
    ]
    expect(
      withoutUnusedCreated(configurations, new Set(['a', 'b']), compound).map((c) => c.id)
    ).toEqual(['a', 'old'])
  })
})

describe('unsavedDetectedRuns', () => {
  it('hides detected runs already saved as the same command', () => {
    const dev = detected('/w/web', 'dev', 'pnpm run dev')
    const lint = detected('/w', 'lint', 'npm run lint')
    const saved = [
      { type: 'command' as const, id: 's', name: 'S', command: 'pnpm run dev', cwd: 'web' }
    ]
    expect(unsavedDetectedRuns([dev, lint], saved, '/w')).toEqual([lint])
    expect(unsavedDetectedRuns(null, saved, '/w')).toBeNull()
  })
})
