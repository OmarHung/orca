import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { debugLaunchTarget } from '../debug/debug-launch'
import { runConfiguration, type RunTarget } from './run-configuration-control'
import { useRunConfigurationStore } from './run-configuration-store'
import { useRecentRunStore } from './recent-run-store'
import {
  stopDebuggingBeforeRun,
  stopRunBeforeDebug,
  type RunDebugLaunchContext
} from './run-debug-exclusivity'
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

function detectedLaunchContext(
  target: RunTarget,
  confirm: ConfirmationDialogContextValue
): RunDebugLaunchContext {
  return {
    worktreeId: target.worktreeId,
    sourceKey: recentItemKey(target.commandKey),
    label: target.command.label,
    confirm
  }
}

/** Runs a detected configuration and makes it the worktree's current one in the tab bar. */
export async function runDetectedConfiguration(
  configuration: DetectedRunConfiguration,
  worktreeId: string,
  groupId: string | null,
  confirm: ConfirmationDialogContextValue
): Promise<void> {
  const target = toDetectedRunTarget(configuration, worktreeId, groupId)
  rememberDetectedRun(target)
  if (await stopDebuggingBeforeRun(detectedLaunchContext(target, confirm))) {
    await runConfiguration(target)
  }
}

/** Debugs a detected configuration and makes it the worktree's current one in the tab bar. */
export async function debugDetectedConfiguration(
  configuration: DetectedRunConfiguration,
  worktreeId: string,
  groupId: string | null,
  confirm: ConfirmationDialogContextValue
): Promise<void> {
  if (!configuration.debug) {
    return
  }
  const target = toDetectedRunTarget(configuration, worktreeId, groupId)
  rememberDetectedRun(target)
  const context = detectedLaunchContext(target, confirm)
  if (!(await stopRunBeforeDebug(context, target))) {
    return
  }
  await debugLaunchTarget({
    worktreeId,
    cwd: configuration.projectDir,
    title: context.label,
    target: configuration.debug,
    sourceKey: context.sourceKey
  })
}
