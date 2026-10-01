import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
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
import { launchRunConfiguration } from './run-configuration-launcher'
import { recentItemKey, type DetectedRunWidgetItem } from './run-widget-items'
import { storedSavedRunFor } from './saved-command-match'

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
    ...(configuration.debug && configuration.debugOptions
      ? { debugOptions: configuration.debugOptions }
      : {}),
    command: {
      id: commandKey,
      label: detectedConfigurationLabel(configuration),
      command: configuration.command,
      appendEnter: true
    }
  }
}

/** A detected run as a Run widget row; it shares its key with the recent entry it becomes. */
export function detectedRunWidgetItem(
  configuration: DetectedRunConfiguration,
  worktreeId: string,
  groupId: string | null
): DetectedRunWidgetItem {
  const target = toDetectedRunTarget(configuration, worktreeId, groupId)
  return {
    kind: 'detected',
    key: recentItemKey(target.commandKey),
    label: target.command.label,
    configuration,
    target
  }
}

/** Keeps the run as the worktree's temporary configuration and selects it in the Run widget. */
export function selectDetectedRun(target: RunTarget): void {
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

function confirmPublish(
  configuration: DetectedRunConfiguration,
  confirm: ConfirmationDialogContextValue
): Promise<boolean> {
  return confirm({
    title: translate('run.publishConfirm.title', "Publish '{{value0}}'?", {
      value0: configuration.projectName
    }),
    description: translate('run.publishConfirm.description', 'This runs: {{value0}}', {
      value0: configuration.command
    }),
    confirmLabel: translate('run.publishConfirm.confirm', 'Publish')
  })
}

/**
 * Runs a detected configuration (asking first for a publish) and makes it the worktree's current
 * one in the tab bar.
 */
export async function runDetectedConfiguration(
  configuration: DetectedRunConfiguration,
  worktreeId: string,
  groupId: string | null,
  confirm: ConfirmationDialogContextValue
): Promise<void> {
  if (configuration.kind === 'publish' && !(await confirmPublish(configuration, confirm))) {
    return
  }
  const target = toDetectedRunTarget(configuration, worktreeId, groupId)
  selectDetectedRun(target)
  const saved = storedSavedRunFor(target)?.saved
  if (!(await stopDebuggingBeforeRun(detectedLaunchContext(target, confirm)))) {
    return
  }
  // Why the launcher: the saved configuration's run is the one already running, if any.
  await (saved
    ? launchRunConfiguration({ worktreeId, groupId, reference: saved.id })
    : runConfiguration(target))
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
  selectDetectedRun(target)
  const saved = storedSavedRunFor(target)?.saved
  const context = detectedLaunchContext(target, confirm)
  if (!(await stopRunBeforeDebug(context, saved?.target ?? target))) {
    return
  }
  await debugLaunchTarget({
    worktreeId,
    cwd: configuration.projectDir,
    title: context.label,
    target: configuration.debug,
    ...(configuration.debugOptions ? { launchOptions: configuration.debugOptions } : {}),
    sourceKey: context.sourceKey
  })
}
