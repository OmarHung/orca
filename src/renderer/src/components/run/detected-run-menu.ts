import { getRelativePathInsideRoot } from '@/lib/path'
import type {
  DetectedRunConfiguration,
  RunConfigurationEcosystem,
  RunConfigurationKind
} from '../../../../shared/run-configurations/run-configuration-types'

const ECOSYSTEM_ORDER: readonly RunConfigurationEcosystem[] = ['dotnet', 'node', 'python']

/** The order kinds are listed in inside a project's submenu. */
export const DETECTED_KIND_ORDER: readonly RunConfigurationKind[] = [
  'run',
  'build',
  'test',
  'publish',
  'other'
]

export type DetectedRunMenuProject = {
  /** Hide key; stable across worktrees of the same repo. */
  key: string
  name: string
  ecosystem: DetectedRunConfiguration['ecosystem']
  /** Workspace-relative folder, '' for the root. */
  location: string
  groups: { kind: RunConfigurationKind; runs: DetectedRunConfiguration[] }[]
}

/** Projects sharing a parent folder, e.g. `core` for `core/Piranha` and `core/Piranha.Manager`. */
export type DetectedRunMenuFolder = {
  /** Workspace-relative parent folder, '' for projects at the root. */
  folder: string
  projects: DetectedRunMenuProject[]
}

export type DetectedRunMenuEcosystem = {
  ecosystem: RunConfigurationEcosystem
  projectCount: number
  /** Root first, then by folder path. */
  folders: DetectedRunMenuFolder[]
}

export type DetectedRunMenu = {
  /** Shown projects by toolchain, then by parent folder. */
  ecosystems: DetectedRunMenuEcosystem[]
  hiddenProjects: DetectedRunMenuProject[]
  /** Runs hidden one by one, in projects that are still shown. */
  hiddenRuns: { key: string; run: DetectedRunConfiguration }[]
}

export function isDetectedRunMenuEmpty(menu: DetectedRunMenu): boolean {
  return menu.ecosystems.length + menu.hiddenProjects.length + menu.hiddenRuns.length === 0
}

/** The folder part and the project's own folder name of a location like `core/Piranha`. */
export function splitLocation(location: string): { folder: string; leaf: string } {
  const slash = location.lastIndexOf('/')
  return slash === -1
    ? { folder: '', leaf: location }
    : { folder: location.slice(0, slash), leaf: location.slice(slash + 1) }
}

function byFolder(projects: readonly DetectedRunMenuProject[]): DetectedRunMenuFolder[] {
  const folders = [...new Set(projects.map((project) => splitLocation(project.location).folder))]
  return folders
    .sort((a, b) => a.localeCompare(b))
    .map((folder) => ({
      folder,
      projects: projects.filter((project) => splitLocation(project.location).folder === folder)
    }))
}

function locationOf(projectDir: string, worktreePath: string): string {
  return (getRelativePathInsideRoot(projectDir, worktreePath) ?? projectDir).replace(/\\/g, '/')
}

// Why relative: detected ids embed the absolute project folder, which differs per worktree.
export function detectedProjectHideKey(
  run: DetectedRunConfiguration,
  worktreePath: string
): string {
  return `project:${run.ecosystem}:${locationOf(run.projectDir, worktreePath)}:${run.projectName}`
}

export function detectedRunHideKey(run: DetectedRunConfiguration, worktreePath: string): string {
  const prefix = `${run.ecosystem}:${run.projectDir}:`
  const rest = run.id.startsWith(prefix) ? run.id.slice(prefix.length) : run.id
  return `run:${run.ecosystem}:${locationOf(run.projectDir, worktreePath)}:${rest}`
}

function projectOf(
  key: string,
  runs: readonly DetectedRunConfiguration[],
  worktreePath: string
): DetectedRunMenuProject {
  const [first] = runs
  return {
    key,
    name: first.projectName,
    ecosystem: first.ecosystem,
    location: locationOf(first.projectDir, worktreePath),
    groups: DETECTED_KIND_ORDER.map((kind) => ({
      kind,
      runs: runs.filter((run) => run.kind === kind)
    })).filter((group) => group.runs.length > 0)
  }
}

/**
 * Detected runs grouped by toolchain, then project, then kind, with what the user hid split out
 * so it can be shown again.
 */
export function detectedRunMenu(
  runs: readonly DetectedRunConfiguration[],
  worktreePath: string,
  hidden: ReadonlySet<string>
): DetectedRunMenu {
  const byProject = new Map<string, DetectedRunConfiguration[]>()
  for (const run of runs) {
    const key = detectedProjectHideKey(run, worktreePath)
    byProject.set(key, [...(byProject.get(key) ?? []), run])
  }
  const byLocation = (a: DetectedRunMenuProject, b: DetectedRunMenuProject): number =>
    a.location.localeCompare(b.location) || a.name.localeCompare(b.name)
  const isRunHidden = (run: DetectedRunConfiguration): boolean =>
    hidden.has(detectedRunHideKey(run, worktreePath))
  const entries = [...byProject]
  const shownEntries = entries.filter(([key]) => !hidden.has(key))
  const projects = shownEntries
    .map(([key, projectRuns]) => [key, projectRuns.filter((run) => !isRunHidden(run))] as const)
    .filter(([, shown]) => shown.length > 0)
    .map(([key, shown]) => projectOf(key, shown, worktreePath))
    .sort(byLocation)
  return {
    ecosystems: ECOSYSTEM_ORDER.map((ecosystem) =>
      projects.filter((project) => project.ecosystem === ecosystem)
    )
      .filter((shown) => shown.length > 0)
      .map((shown) => ({
        ecosystem: shown[0].ecosystem,
        projectCount: shown.length,
        folders: byFolder(shown)
      })),
    hiddenProjects: entries
      .filter(([key]) => hidden.has(key))
      .map(([key, projectRuns]) => projectOf(key, projectRuns, worktreePath))
      .sort(byLocation),
    hiddenRuns: shownEntries
      .flatMap(([, projectRuns]) => projectRuns.filter(isRunHidden))
      .map((run) => ({ key: detectedRunHideKey(run, worktreePath), run }))
  }
}
