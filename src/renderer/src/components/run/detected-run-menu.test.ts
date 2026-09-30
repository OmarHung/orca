import { describe, expect, it } from 'vitest'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { detectedProjectHideKey, detectedRunHideKey, detectedRunMenu } from './detected-run-menu'

function run(
  projectDir: string,
  projectName: string,
  name: string,
  kind: DetectedRunConfiguration['kind'],
  ecosystem: DetectedRunConfiguration['ecosystem'] = 'node'
): DetectedRunConfiguration {
  return {
    id: `${ecosystem}:${projectDir}:script:${name}`,
    ecosystem,
    projectName,
    projectDir,
    kind,
    name,
    command: `pnpm run ${name}`
  }
}

const RUNS = [
  run('/w/apps/web', 'web', 'lint', 'other'),
  run('/w/apps/web', 'web', 'build', 'build'),
  run('/w/apps/web', 'web', 'dev', 'run'),
  run('/w/apps/web', 'web', 'test', 'test'),
  run('/w', 'root', 'format', 'other'),
  run('/w/api', 'api', 'main.py', 'run', 'python')
]

describe('detected run hide keys', () => {
  it('are relative to the worktree, so every worktree of a repo shares them', () => {
    const inMain = run('/w/apps/web', 'web', 'dev', 'run')
    const inOther = run('/other/apps/web', 'web', 'dev', 'run')

    expect(detectedRunHideKey(inMain, '/w')).toBe('run:node:apps/web:script:dev')
    expect(detectedRunHideKey(inOther, '/other')).toBe(detectedRunHideKey(inMain, '/w'))
    expect(detectedProjectHideKey(inMain, '/w')).toBe('project:node:apps/web:web')
    expect(detectedProjectHideKey(run('/w', 'root', 'x', 'other'), '/w')).toBe('project:node::root')
  })
})

describe('detectedRunMenu', () => {
  it('groups by project, root first, and orders each project by kind', () => {
    const menu = detectedRunMenu(RUNS, '/w', new Set())

    expect(menu.projects.map((project) => [project.name, project.location])).toEqual([
      ['root', ''],
      ['api', 'api'],
      ['web', 'apps/web']
    ])
    expect(
      menu.projects[2].groups.map((group) => [group.kind, group.runs.map((entry) => entry.name)])
    ).toEqual([
      ['run', ['dev']],
      ['build', ['build']],
      ['test', ['test']],
      ['other', ['lint']]
    ])
    expect(menu.hiddenProjects).toEqual([])
    expect(menu.hiddenRuns).toEqual([])
  })

  it('splits out hidden projects and hidden runs; a project with every run hidden disappears', () => {
    const menu = detectedRunMenu(
      RUNS,
      '/w',
      new Set([
        'project:python:api:api',
        'run:node:apps/web:script:lint',
        'run:node::script:format',
        'run:python:api:script:main.py'
      ])
    )

    expect(menu.projects.map((project) => project.name)).toEqual(['web'])
    expect(menu.projects[0].groups.map((group) => group.kind)).toEqual(['run', 'build', 'test'])
    expect(menu.hiddenProjects.map((project) => project.name)).toEqual(['api'])
    expect(menu.hiddenRuns.map((entry) => [entry.key, entry.run.name])).toEqual([
      ['run:node:apps/web:script:lint', 'lint'],
      ['run:node::script:format', 'format']
    ])
  })
})
