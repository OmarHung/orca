import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { debugLaunchTarget } from '../debug/debug-launch'
import { runConfiguration, type RunTarget } from './run-configuration-control'
import { useRunConfigurationStore } from './run-configuration-store'
import { useRecentRunStore } from './recent-run-store'
import { recentItemKey } from './run-widget-items'

export function detectedConfigurationLabel(configuration: DetectedRunConfiguration): string {
  return `${configuration.projectName}: ${configuration.name}`
}

export function toDetectedRunTarget(
  configuration: DetectedRunConfiguration,
  worktreeId: string,
  groupId: string | null
): RunTarget {
  const commandKey = `detected:${configuration.id}`
  return {
    worktreeId,
    groupId,
    commandKey,
    cwd: configuration.projectDir,
    ...(configuration.debug ? { debug: configuration.debug } : {}),
    command: {
      id: commandKey,
      label: detectedConfigurationLabel(configuration),
      command: configuration.command,
      appendEnter: true
    }
  }
}

/** Keeps the run as the worktree's temporary configuration and selects it in the Run widget. */
function rememberDetectedRun(target: RunTarget): void {
  useRecentRunStore.getState().remember(target)
  const worktreesByRepo = useAppStore.getState().worktreesByRepo
  const repoId = worktreesByRepo
    ? findWorktreeById(worktreesByRepo, target.worktreeId)?.repoId
    : undefined
  if (repoId) {
    useRunConfigurationStore.getState().select(repoId, recentItemKey(target.commandKey))
  }
}

/** Runs a detected configuration and makes it the worktree's current one in the tab bar. */
export async function runDetectedConfiguration(
  configuration: DetectedRunConfiguration,
  worktreeId: string,
  groupId: string | null
): Promise<void> {
  const target = toDetectedRunTarget(configuration, worktreeId, groupId)
  rememberDetectedRun(target)
  await runConfiguration(target)
}

/** Debugs a detected configuration and makes it the worktree's current one in the tab bar. */
export async function debugDetectedConfiguration(
  configuration: DetectedRunConfiguration,
  worktreeId: string,
  groupId: string | null
): Promise<void> {
  if (!configuration.debug) {
    return
  }
  rememberDetectedRun(toDetectedRunTarget(configuration, worktreeId, groupId))
  await debugLaunchTarget({
    worktreeId,
    cwd: configuration.projectDir,
    title: detectedConfigurationLabel(configuration),
    target: configuration.debug
  })
}
