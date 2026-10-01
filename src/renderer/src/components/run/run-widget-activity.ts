import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import { planRunConfiguration } from '../../../../shared/run-configurations/run-configuration-plan'
import { isTerminalAgentQuickCommand } from '../../../../shared/terminal-quick-commands'
import type { DebugSessionView } from '../debug/debug-store'
import {
  isRunSessionActive,
  runStopStage,
  type RunSession,
  type RunStopStage
} from './run-session-store'
import {
  configurationCommandKey,
  configurationItemKey,
  type RunWidgetItem
} from './run-widget-items'

/** What an item starts: terminal runs by command key, and the item keys its debug session carries. */
export type RunWidgetFootprint = {
  commandKeys: readonly string[]
  debugSourceKeys: readonly string[]
}

/** What is going on in one worktree, as the Run widget shows and stops it. */
export type RunWidgetActivity = {
  /** Active runs whose stable terminal pane still exists, oldest first. */
  runs: readonly RunSession[]
  /** The worktree's debug session while it lasts. */
  debug: DebugSessionView | null
}

export const NO_RUN_ACTIVITY: RunWidgetActivity = { runs: [], debug: null }

export function isCompoundItem(item: RunWidgetItem): boolean {
  return item.kind === 'configuration' && item.configuration.type === 'compound'
}

function compoundFootprint(
  item: RunWidgetItem & { kind: 'configuration' },
  configurations: readonly RunConfigurationDefinition[]
): RunWidgetFootprint {
  const result = planRunConfiguration(configurations, item.configuration.id)
  if (!result.ok) {
    return { commandKeys: [], debugSourceKeys: [item.key] }
  }
  // Why Before launch too: stopping the compound must also stop the step it is waiting on.
  const members = [...result.plan.beforeLaunch, ...result.plan.launches]
  return {
    commandKeys: members
      .filter((member) => member.type === 'command')
      .map((member) => configurationCommandKey(member.id)),
    debugSourceKeys: [
      item.key,
      ...members
        .filter((member) => member.type === 'debug')
        .map((member) => configurationItemKey(member.id))
    ]
  }
}

export function runWidgetFootprint(
  item: RunWidgetItem,
  configurations: readonly RunConfigurationDefinition[]
): RunWidgetFootprint {
  switch (item.kind) {
    case 'recent':
      return { commandKeys: [item.target.commandKey], debugSourceKeys: [item.key] }
    case 'detected':
      return {
        commandKeys: [(item.savedTarget ?? item.target).commandKey],
        debugSourceKeys: [item.key]
      }
    case 'current-file':
      return {
        commandKeys: item.target ? [item.target.commandKey] : [],
        debugSourceKeys: [item.key]
      }
    case 'quick-command':
      return {
        commandKeys: isTerminalAgentQuickCommand(item.entry.command) ? [] : [item.entry.key],
        debugSourceKeys: []
      }
    case 'configuration':
      switch (item.configuration.type) {
        case 'command':
        case 'dotnet-publish':
          return {
            commandKeys: [configurationCommandKey(item.configuration.id)],
            debugSourceKeys: []
          }
        case 'debug':
          return { commandKeys: [], debugSourceKeys: [item.key] }
        case 'compound':
          return compoundFootprint(item, configurations)
      }
  }
}

export function worktreeRunActivity(options: {
  worktreeId: string
  sessions: readonly RunSession[]
  liveLeafIds: ReadonlySet<string>
  debug: DebugSessionView | null
}): RunWidgetActivity {
  const { worktreeId, debug } = options
  return {
    runs: options.sessions.filter(
      (session) =>
        session.worktreeId === worktreeId &&
        isRunSessionActive(session.status) &&
        options.liveLeafIds.has(session.leafId)
    ),
    debug: debug && debug.worktreeId === worktreeId && debug.phase !== 'ended' ? debug : null
  }
}

export function footprintRuns(
  footprint: RunWidgetFootprint,
  activity: RunWidgetActivity
): RunSession[] {
  return activity.runs.filter((run) => footprint.commandKeys.includes(run.commandKey))
}

export function isFootprintDebugging(
  footprint: RunWidgetFootprint,
  activity: RunWidgetActivity
): boolean {
  const sourceKey = activity.debug?.sourceKey
  return sourceKey !== undefined && footprint.debugSourceKeys.includes(sourceKey)
}

export function isFootprintActive(
  footprint: RunWidgetFootprint,
  activity: RunWidgetActivity
): boolean {
  return footprintRuns(footprint, activity).length > 0 || isFootprintDebugging(footprint, activity)
}

/** One entry in the Stop menu: a run's terminal or the debug session. */
export type RunningProcess =
  | { kind: 'run'; key: string; label: string; commandKey: string; stage: RunStopStage }
  | { kind: 'debug'; key: string; label: string }

export function runningProcesses(activity: RunWidgetActivity): RunningProcess[] {
  return [
    ...activity.runs.map((run) => ({
      kind: 'run' as const,
      key: run.key,
      label: run.label,
      commandKey: run.commandKey,
      stage: runStopStage(run)
    })),
    ...(activity.debug
      ? [{ kind: 'debug' as const, key: `debug:${activity.debug.id}`, label: activity.debug.title }]
      : [])
  ]
}
