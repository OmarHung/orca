import { getRelativePathInsideRoot } from '@/lib/path'
import type {
  CommandRunConfiguration,
  CompoundRunConfiguration,
  RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { detectedConfigurationLabel } from './detected-run-configuration'
import { uniqueName } from './run-configuration-drafts'

/** Relative to the workspace root so the configuration works in every worktree of the repo. */
function workspaceRelativeCwd(projectDir: string, worktreePath: string): string | undefined {
  const relative = getRelativePathInsideRoot(projectDir, worktreePath)
  return relative === null ? projectDir : relative || undefined
}

/**
 * The command configuration a compound references for a detected run: an identical saved
 * one when it exists, otherwise a new one the caller must add.
 */
export function detectedCommandConfiguration(
  detected: DetectedRunConfiguration,
  existing: readonly RunConfigurationDefinition[],
  worktreePath: string,
  createId: () => string
): { id: string; created?: CommandRunConfiguration } {
  const cwd = workspaceRelativeCwd(detected.projectDir, worktreePath)
  const match = existing.find(
    (configuration) =>
      configuration.type === 'command' &&
      configuration.command === detected.command &&
      configuration.cwd === cwd &&
      !configuration.beforeLaunch
  )
  if (match) {
    return { id: match.id }
  }
  const created: CommandRunConfiguration = {
    type: 'command',
    id: createId(),
    name: uniqueName(detectedConfigurationLabel(detected), existing),
    command: detected.command,
    ...(cwd ? { cwd } : {})
  }
  return { id: created.id, created }
}

/** Detected runs not already saved as an identical command (those are listed as saved). */
export function unsavedDetectedRuns(
  detected: readonly DetectedRunConfiguration[] | null,
  saved: readonly RunConfigurationDefinition[],
  worktreePath: string
): DetectedRunConfiguration[] | null {
  return (
    detected?.filter(
      (run) => detectedCommandConfiguration(run, saved, worktreePath, () => '').created
    ) ?? null
  )
}

export function newSequentialCompound(id: string): CompoundRunConfiguration {
  return {
    type: 'compound',
    id,
    name: '',
    configurations: [],
    sequential: true
  }
}

/** Drops configurations created while editing that the final compound no longer uses. */
export function withoutUnusedCreated(
  configurations: readonly RunConfigurationDefinition[],
  createdIds: ReadonlySet<string>,
  compound: CompoundRunConfiguration
): RunConfigurationDefinition[] {
  const used = new Set(compound.configurations)
  return configurations.filter(
    (configuration) => !createdIds.has(configuration.id) || used.has(configuration.id)
  )
}
