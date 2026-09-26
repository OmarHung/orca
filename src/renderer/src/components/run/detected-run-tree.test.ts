import { describe, expect, it } from 'vitest'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { detectedRunTree, filterDetectedRunTree } from './detected-run-tree'

function run(
  projectDir: string,
  projectName: string,
  name: string,
  ecosystem: DetectedRunConfiguration['ecosystem'] = 'node'
): DetectedRunConfiguration {
  return {
    id: `${projectDir}:${name}`,
    ecosystem,
    projectName,
    projectDir,
    kind: 'run',
    name,
    command: name
  }
}

const RUNS = [
  run('/w/frontend/admin', 'admin', 'dev'),
  run('/w/frontend/shop', 'shop', 'dev'),
  run('/w/backend/src/Api', 'Api', 'Build', 'dotnet'),
  run('/w/backend/src/Api', 'Api', 'http', 'dotnet'),
  run('/w', 'root', 'lint')
]

describe('detectedRunTree', () => {
  it('nests by folder, merges single-child chains and groups runs per project', () => {
    const tree = detectedRunTree(RUNS, '/w')

    expect(tree.projects.map((project) => project.name)).toEqual(['root'])
    expect(tree.folders.map((folder) => folder.label)).toEqual(['backend/src/Api', 'frontend'])
    const [backend, frontend] = tree.folders
    expect(backend.projects).toHaveLength(1)
    expect(backend.projects[0].runs.map((entry) => entry.name)).toEqual(['Build', 'http'])
    expect(frontend.folders.map((folder) => folder.label)).toEqual(['admin', 'shop'])
  })

  it('filters runs by name and keeps whole projects or folders that match', () => {
    const tree = detectedRunTree(RUNS, '/w')

    const byRun = filterDetectedRunTree(tree, 'HTTP')
    expect(byRun?.projects).toEqual([])
    expect(byRun?.folders[0].projects[0].runs.map((entry) => entry.name)).toEqual(['http'])
    expect(filterDetectedRunTree(tree, 'shop')?.folders[0].folders[0].label).toBe('shop')
    expect(filterDetectedRunTree(tree, 'nothing')).toBeNull()
  })
})
