import { getRelativePathInsideRoot } from '@/lib/path'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'

export type DetectedRunProject = {
  key: string
  name: string
  ecosystem: DetectedRunConfiguration['ecosystem']
  runs: DetectedRunConfiguration[]
}

/** A folder node; single-child folder chains are merged (`backend/src/Api`) like IDE trees. */
export type DetectedRunFolder = {
  key: string
  label: string
  folders: DetectedRunFolder[]
  projects: DetectedRunProject[]
}

type MutableFolder = {
  folders: Map<string, MutableFolder>
  projects: Map<string, DetectedRunProject>
}

function emptyFolder(): MutableFolder {
  return { folders: new Map(), projects: new Map() }
}

function segmentsOf(projectDir: string, worktreePath: string): string[] {
  const relative = getRelativePathInsideRoot(projectDir, worktreePath)
  return (relative ?? projectDir).split(/[\\/]+/).filter(Boolean)
}

function freeze(folder: MutableFolder, key: string, label: string): DetectedRunFolder {
  let current = folder
  let path = key
  let name = label
  // Why: a folder holding only one subfolder adds a click without adding information.
  while (current.projects.size === 0 && current.folders.size === 1 && name) {
    const [childName, child] = [...current.folders][0]
    current = child
    path = `${path}/${childName}`
    name = `${name}/${childName}`
  }
  return {
    key: path,
    label: name,
    folders: [...current.folders]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([childName, child]) => freeze(child, `${path}/${childName}`, childName)),
    projects: [...current.projects.values()]
  }
}

/** Groups detected runs by workspace folder, then by project (a folder can hold several). */
export function detectedRunTree(
  runs: readonly DetectedRunConfiguration[],
  worktreePath: string
): DetectedRunFolder {
  const root = emptyFolder()
  for (const run of runs) {
    let folder = root
    for (const segment of segmentsOf(run.projectDir, worktreePath)) {
      const next = folder.folders.get(segment) ?? emptyFolder()
      folder.folders.set(segment, next)
      folder = next
    }
    const projectKey = `${run.projectDir}::${run.ecosystem}::${run.projectName}`
    const project = folder.projects.get(projectKey) ?? {
      key: projectKey,
      name: run.projectName,
      ecosystem: run.ecosystem,
      runs: []
    }
    folder.projects.set(projectKey, { ...project, runs: [...project.runs, run] })
  }
  return freeze(root, '', '')
}

/** The same tree with only runs whose label or project matches; empty branches are dropped. */
export function filterDetectedRunTree(
  folder: DetectedRunFolder,
  query: string
): DetectedRunFolder | null {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return folder
  }
  const projects = folder.projects
    .map((project) => ({
      ...project,
      runs: project.name.toLowerCase().includes(needle)
        ? project.runs
        : project.runs.filter((run) => run.name.toLowerCase().includes(needle))
    }))
    .filter((project) => project.runs.length > 0)
  const folders = folder.folders
    .map((child) =>
      child.label.toLowerCase().includes(needle) ? child : filterDetectedRunTree(child, needle)
    )
    .filter((child): child is DetectedRunFolder => child !== null)
  return projects.length > 0 || folders.length > 0 ? { ...folder, folders, projects } : null
}
