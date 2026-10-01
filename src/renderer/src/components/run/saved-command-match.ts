import { getRelativePathInsideRoot } from '@/lib/path'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type {
  CommandRunConfiguration,
  RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'
import { resolveCommandLaunch } from '../../../../shared/run-configurations/run-configuration-resolve'
import { configurationRunTarget } from './run-configuration-launcher'
import { combineRunConfigurations, useRunConfigurationStore } from './run-configuration-store'
import type { RunTarget } from './run-target'

/** A saved configuration that is the same run, and the terminal run it owns. */
export type SavedRun = { id: string; target: RunTarget }

const NO_CONFIGURATIONS: RunConfigurationDefinition[] = []

/** Relative to the workspace root so the configuration works in every worktree of the repo. */
export function workspaceRelativeCwd(projectDir: string, worktreePath: string): string | undefined {
  const relative = getRelativePathInsideRoot(projectDir, worktreePath)
  return relative === null ? projectDir : relative || undefined
}

/** The saved command configuration that runs exactly this command in this directory. */
export function savedCommandFor(
  command: string,
  cwd: string | undefined,
  configurations: readonly RunConfigurationDefinition[],
  worktreePath: string
): CommandRunConfiguration | null {
  const relativeCwd = cwd === undefined ? undefined : workspaceRelativeCwd(cwd, worktreePath)
  return (
    configurations.find(
      (configuration): configuration is CommandRunConfiguration =>
        configuration.type === 'command' &&
        configuration.command === command &&
        configuration.cwd === relativeCwd &&
        !configuration.beforeLaunch
    ) ?? null
  )
}

/**
 * Like JetBrains, a temporary run saved as a configuration (e.g. into a compound) becomes that
 * configuration, so the two share one single-instance terminal instead of running twice.
 */
export function savedRunFor(
  target: Pick<RunTarget, 'command' | 'cwd' | 'worktreeId' | 'groupId'>,
  configurations: readonly RunConfigurationDefinition[],
  worktreePath: string
): SavedRun | null {
  const saved = savedCommandFor(target.command.command, target.cwd, configurations, worktreePath)
  const launch = saved ? resolveCommandLaunch(saved, { workspaceFolder: worktreePath }) : null
  return saved && launch?.ok
    ? {
        id: saved.id,
        target: configurationRunTarget(saved, launch.value, target.worktreeId, target.groupId)
      }
    : null
}

/** `savedRunFor` with the workspace's configurations as currently stored. */
export function storedSavedRunFor(
  target: Pick<RunTarget, 'command' | 'cwd' | 'worktreeId' | 'groupId'>
): { repoId: string; saved: SavedRun } | null {
  const { worktreesByRepo } = useAppStore.getState()
  const worktree = worktreesByRepo
    ? findWorktreeById(worktreesByRepo, target.worktreeId)
    : undefined
  if (!worktree) {
    return null
  }
  const store = useRunConfigurationStore.getState()
  const configurations = combineRunConfigurations(
    store.localByRepo[worktree.repoId] ?? NO_CONFIGURATIONS,
    store.sharedByWorktree[target.worktreeId]?.configurations ?? NO_CONFIGURATIONS
  ).map((entry) => entry.configuration)
  const saved = savedRunFor(target, configurations, worktree.path)
  return saved ? { repoId: worktree.repoId, saved } : null
}
