import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { useAppStore } from '@/store'
import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import { commandConfigurationOf } from '../../../../shared/run-configurations/run-configuration-plan'
import { resolveCommandLaunch } from '../../../../shared/run-configurations/run-configuration-resolve'
import { debugLaunchTarget } from '../debug/debug-launch'
import { debugDetectedConfiguration, runDetectedConfiguration } from './detected-run-configuration'
import { stopDebugSession } from '../debug/debug-session-controller'
import {
  runConfiguration,
  stopConfiguration,
  toRunTarget,
  type RunTarget
} from './run-configuration-control'
import {
  cancelPendingLaunches,
  configurationRunTarget,
  launchRunConfiguration
} from './run-configuration-launcher'
import {
  stopDebuggingBeforeRun,
  stopRunBeforeDebug,
  type RunDebugLaunchContext
} from './run-debug-exclusivity'
import { gentlestStopStage, runStopStage, type RunStopStage } from './run-session-store'
import {
  footprintRuns,
  isFootprintDebugging,
  type RunningProcess,
  type RunWidgetActivity,
  type RunWidgetFootprint
} from './run-widget-activity'
import { configurationIdOfCommandKey, type RunWidgetItem } from './run-widget-items'

export type RunWidgetScope = { worktreeId: string; groupId: string | null; worktreePath: string }

/** The single-instance run behind an item, for status, Rerun and Stop; null when it has none. */
export function runWidgetSessionTarget(
  item: RunWidgetItem,
  scope: RunWidgetScope
): RunTarget | null {
  switch (item.kind) {
    case 'recent':
    case 'detected':
      return item.savedTarget ?? item.target
    case 'current-file':
      return item.target
    case 'quick-command':
      return toRunTarget(item.entry, scope.worktreeId, scope.groupId)
    case 'configuration': {
      const command = commandConfigurationOf(item.configuration)
      if (!command) {
        return null
      }
      const launch = resolveCommandLaunch(command, { workspaceFolder: scope.worktreePath })
      return launch.ok
        ? configurationRunTarget(command, launch.value, scope.worktreeId, scope.groupId)
        : null
    }
  }
}

/** Debug-only configurations have no plain run: their adapters always attach a debugger. */
export function canRunWidgetItem(item: RunWidgetItem): boolean {
  if (item.kind === 'current-file') {
    return item.target !== null
  }
  return !(item.kind === 'configuration' && item.configuration.type === 'debug')
}

export function canDebugWidgetItem(item: RunWidgetItem): boolean {
  if (item.kind === 'recent') {
    return Boolean(item.target.debug && item.target.cwd)
  }
  if (item.kind === 'detected') {
    return Boolean(item.configuration.debug)
  }
  if (item.kind === 'current-file') {
    return item.debug !== null
  }
  return item.kind === 'configuration' && item.configuration.type === 'debug'
}

function launchContext(
  item: RunWidgetItem,
  scope: RunWidgetScope,
  confirm: ConfirmationDialogContextValue
): RunDebugLaunchContext {
  return { worktreeId: scope.worktreeId, sourceKey: item.key, label: item.label, confirm }
}

export async function runWidgetItem(
  item: RunWidgetItem,
  scope: RunWidgetScope,
  confirm: ConfirmationDialogContextValue
): Promise<void> {
  if (item.kind === 'detected') {
    // Why: this path also asks before a publish and makes the run the current temporary one.
    await runDetectedConfiguration(item.configuration, scope.worktreeId, scope.groupId, confirm)
    return
  }
  if (!(await stopDebuggingBeforeRun(launchContext(item, scope, confirm)))) {
    return
  }
  switch (item.kind) {
    case 'recent': {
      // Why the launcher: a run saved as a configuration runs as that one, once.
      const savedId = item.savedTarget && configurationIdOfCommandKey(item.savedTarget.commandKey)
      await (savedId
        ? launchRunConfiguration({ ...scope, reference: savedId })
        : runConfiguration({ ...item.target, groupId: scope.groupId }))
      return
    }
    case 'current-file':
      if (item.target) {
        await runConfiguration(item.target)
      }
      return
    case 'configuration':
      await launchRunConfiguration({ ...scope, reference: item.configuration.id })
      return
    case 'quick-command': {
      const target = toRunTarget(item.entry, scope.worktreeId, scope.groupId)
      if (!target) {
        // Agent prompts start an agent in a new tab; they have no single-instance run.
        runQuickCommandInNewTab({
          command: item.entry.command,
          worktreeId: scope.worktreeId,
          groupId: scope.groupId,
          historyId: item.entry.key
        })
        return
      }
      await runConfiguration(target)
      if (scope.groupId) {
        useAppStore.getState().setRecentQuickCommandForGroup(scope.groupId, item.entry.key)
      }
    }
  }
}

export async function debugWidgetItem(
  item: RunWidgetItem,
  scope: RunWidgetScope,
  confirm: ConfirmationDialogContextValue
): Promise<void> {
  if (item.kind === 'detected') {
    await debugDetectedConfiguration(item.configuration, scope.worktreeId, scope.groupId, confirm)
    return
  }
  const context = launchContext(item, scope, confirm)
  if (!(await stopRunBeforeDebug(context, runWidgetSessionTarget(item, scope)))) {
    return
  }
  if (item.kind === 'configuration') {
    await launchRunConfiguration({ ...scope, reference: item.configuration.id })
    return
  }
  if (item.kind === 'current-file' && item.debug) {
    await debugLaunchTarget({
      worktreeId: scope.worktreeId,
      cwd: item.debug.cwd,
      title: item.target?.command.label ?? item.label,
      target: item.debug.target,
      sourceKey: item.key
    })
    return
  }
  if (item.kind === 'recent' && item.target.debug && item.target.cwd) {
    await debugLaunchTarget({
      worktreeId: scope.worktreeId,
      cwd: item.target.cwd,
      title: item.label,
      target: item.target.debug,
      ...(item.target.debugOptions ? { launchOptions: item.target.debugOptions } : {}),
      sourceKey: item.key
    })
  }
}

/** Takes each run one Stop step further, but only those at the gentlest step among them. */
function stopRunsOneStep(
  runs: readonly { commandKey: string; stage: RunStopStage }[],
  worktreeId: string
): void {
  const next = gentlestStopStage(runs.map((run) => run.stage))
  for (const run of runs) {
    if (run.stage === next) {
      stopConfiguration(worktreeId, run.commandKey)
    }
  }
}

/** Stops everything an item started; a compound also stops starting the members still to come. */
export function stopRunWidgetItem(
  item: RunWidgetItem,
  footprint: RunWidgetFootprint,
  activity: RunWidgetActivity,
  worktreeId: string
): void {
  if (item.kind === 'configuration') {
    cancelPendingLaunches(worktreeId, item.configuration.id)
  }
  stopRunsOneStep(
    footprintRuns(footprint, activity).map((run) => ({
      commandKey: run.commandKey,
      stage: runStopStage(run)
    })),
    worktreeId
  )
  if (isFootprintDebugging(footprint, activity)) {
    void stopDebugSession()
  }
}

export function stopRunningProcess(process: RunningProcess, worktreeId: string): void {
  if (process.kind === 'debug') {
    void stopDebugSession()
    return
  }
  stopConfiguration(worktreeId, process.commandKey)
}

/** JetBrains' Stop All: every run one step further, the debug session, and no further members. */
export function stopAllRunningProcesses(
  processes: readonly RunningProcess[],
  worktreeId: string
): void {
  cancelPendingLaunches(worktreeId)
  stopRunsOneStep(
    processes.flatMap((process) => (process.kind === 'run' ? [process] : [])),
    worktreeId
  )
  if (processes.some((process) => process.kind === 'debug')) {
    void stopDebugSession()
  }
}
