import { getRelativePathInsideRoot } from '@/lib/path'
import type {
  DetectedRunConfiguration,
  RunConfigurationKind
} from '../../../../shared/run-configurations/run-configuration-types'

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

export type DetectedRunMenu = {
  projects: DetectedRunMenuProject[]
  hiddenProjects: DetectedRunMenuProject[]
  /** Runs hidden one by one, in projects that are still shown. */
  hiddenRuns: { key: string; run: DetectedRunConfiguration }[]
}

export function isDetectedRunMenuEmpty(menu: DetectedRunMenu): boolean {
  return menu.projects.length + menu.hiddenProjects.length + menu.hiddenRuns.length === 0
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
 * Detected runs grouped by project (root first, then by folder), each project's runs grouped by
 * kind, with what the user hid split out so it can be shown again.
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
  return {
    projects: shownEntries
      .map(([key, projectRuns]) => [key, projectRuns.filter((run) => !isRunHidden(run))] as const)
      .filter(([, shown]) => shown.length > 0)
      .map(([key, shown]) => projectOf(key, shown, worktreePath))
      .sort(byLocation),
    hiddenProjects: entries
      .filter(([key]) => hidden.has(key))
      .map(([key, projectRuns]) => projectOf(key, projectRuns, worktreePath))
      .sort(byLocation),
    hiddenRuns: shownEntries
      .flatMap(([, projectRuns]) => projectRuns.filter(isRunHidden))
      .map((run) => ({ key: detectedRunHideKey(run, worktreePath), run }))
  }
}
