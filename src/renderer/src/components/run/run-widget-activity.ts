import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import { planRunConfiguration } from '../../../../shared/run-configurations/run-configuration-plan'
import { isTerminalAgentQuickCommand } from '../../../../shared/terminal-quick-commands'
import type { DebugSessionView } from '../debug/debug-store'
import { debugPortOwnerKey, runPortOwnerKey } from './run-port-claims'
import { runWidgetItemMode, type RunMode } from './run-mode'
import {
  isRunSessionActive,
  runStopStage,
  type RunSession,
  type RunStopStage
} from './run-session-store'
import {
  configurationCommandKey,
  configurationItemKey,
  debugSourceKeyOf,
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
  /** The worktree's debug sessions that have not ended, oldest first. */
  debugSessions: readonly DebugSessionView[]
}

export const NO_RUN_ACTIVITY: RunWidgetActivity = { runs: [], debugSessions: [] }

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
    case 'detected':
      return {
        commandKeys: [(item.savedTarget ?? item.target).commandKey],
        debugSourceKeys: [item.key]
      }
    case 'current-file':
      return {
        commandKeys: item.target ? [item.target.commandKey] : [],
        debugSourceKeys: [debugSourceKeyOf(item)]
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
        case 'docker-export':
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
  debugSessions: readonly DebugSessionView[]
}): RunWidgetActivity {
  const { worktreeId } = options
  return {
    runs: options.sessions.filter(
      (session) =>
        session.worktreeId === worktreeId &&
        isRunSessionActive(session.status) &&
        options.liveLeafIds.has(session.leafId)
    ),
    debugSessions: options.debugSessions.filter(
      (session) => session.worktreeId === worktreeId && session.phase !== 'ended'
    )
  }
}

export function footprintRuns(
  footprint: RunWidgetFootprint,
  activity: RunWidgetActivity
): RunSession[] {
  return activity.runs.filter((run) => footprint.commandKeys.includes(run.commandKey))
}

/** The debug sessions an item started (a compound can start several). */
export function footprintDebugSessions(
  footprint: RunWidgetFootprint,
  activity: RunWidgetActivity
): DebugSessionView[] {
  return activity.debugSessions.filter(
    (session) =>
      session.sourceKey !== undefined && footprint.debugSourceKeys.includes(session.sourceKey)
  )
}

/** The run and debug sessions whose listening ports the item's Run widget shows. */
export function footprintPortOwnerKeys(
  footprint: RunWidgetFootprint,
  activity: RunWidgetActivity
): string[] {
  return [
    ...footprintRuns(footprint, activity).map((run) => runPortOwnerKey(run.key)),
    ...footprintDebugSessions(footprint, activity).map((session) => debugPortOwnerKey(session.id))
  ]
}

export function isFootprintDebugging(
  footprint: RunWidgetFootprint,
  activity: RunWidgetActivity
): boolean {
  return footprintDebugSessions(footprint, activity).length > 0
}

export function isFootprintActive(
  footprint: RunWidgetFootprint,
  activity: RunWidgetActivity
): boolean {
  return footprintRuns(footprint, activity).length > 0 || isFootprintDebugging(footprint, activity)
}

/** What the widget trigger shows beside the selected item's name while it is live. */
export type RunWidgetLiveStatus = { mode: RunMode; run: RunSession | null }

export function runWidgetLiveStatus(
  item: RunWidgetItem,
  footprint: RunWidgetFootprint,
  activity: RunWidgetActivity
): RunWidgetLiveStatus | null {
  const [run] = footprintRuns(footprint, activity)
  if (run) {
    return { mode: runWidgetItemMode(item), run }
  }
  return isFootprintDebugging(footprint, activity) ? { mode: 'debug', run: null } : null
}

/** One entry in the Stop menu: a run's terminal or a debug session. */
export type RunningProcess =
  | { kind: 'run'; key: string; label: string; commandKey: string; stage: RunStopStage }
  | { kind: 'debug'; key: string; label: string; sessionId: string }

export function runningProcesses(activity: RunWidgetActivity): RunningProcess[] {
  return [
    ...activity.runs.map((run) => ({
      kind: 'run' as const,
      key: run.key,
      label: run.label,
      commandKey: run.commandKey,
      stage: runStopStage(run)
    })),
    ...activity.debugSessions.map((session) => ({
      kind: 'debug' as const,
      key: `debug:${session.id}`,
      label: session.title,
      sessionId: session.id
    }))
  ]
}
