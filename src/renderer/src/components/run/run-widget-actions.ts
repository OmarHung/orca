import { useAppStore } from '@/store'
import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import { resolveCommandLaunch } from '../../../../shared/run-configurations/run-configuration-resolve'
import { debugLaunchTarget } from '../debug/debug-launch'
import { runConfiguration, toRunTarget, type RunTarget } from './run-configuration-control'
import { configurationRunTarget, launchRunConfiguration } from './run-configuration-launcher'
import type { RunWidgetItem } from './run-widget-items'

export type RunWidgetScope = { worktreeId: string; groupId: string | null; worktreePath: string }

/** The single-instance run behind an item, for status, Rerun and Stop; null when it has none. */
export function runWidgetSessionTarget(
  item: RunWidgetItem,
  scope: RunWidgetScope
): RunTarget | null {
  switch (item.kind) {
    case 'detected':
      return item.target
    case 'quick-command':
      return toRunTarget(item.entry, scope.worktreeId, scope.groupId)
    case 'configuration': {
      if (item.configuration.type !== 'command') {
        return null
      }
      const launch = resolveCommandLaunch(item.configuration, {
        workspaceFolder: scope.worktreePath
      })
      return launch.ok
        ? configurationRunTarget(item.configuration, launch.value, scope.worktreeId, scope.groupId)
        : null
    }
  }
}

/** Debug-only configurations have no plain run: their adapters always attach a debugger. */
export function canRunWidgetItem(item: RunWidgetItem): boolean {
  return !(item.kind === 'configuration' && item.configuration.type === 'debug')
}

export function canDebugWidgetItem(item: RunWidgetItem): boolean {
  if (item.kind === 'detected') {
    return Boolean(item.target.debug && item.target.cwd)
  }
  return item.kind === 'configuration' && item.configuration.type === 'debug'
}

export async function runWidgetItem(item: RunWidgetItem, scope: RunWidgetScope): Promise<void> {
  switch (item.kind) {
    case 'detected':
      await runConfiguration({ ...item.target, groupId: scope.groupId })
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

export async function debugWidgetItem(item: RunWidgetItem, scope: RunWidgetScope): Promise<void> {
  if (item.kind === 'configuration') {
    await launchRunConfiguration({ ...scope, reference: item.configuration.id })
    return
  }
  if (item.kind === 'detected' && item.target.debug && item.target.cwd) {
    await debugLaunchTarget({
      worktreeId: scope.worktreeId,
      cwd: item.target.cwd,
      title: item.label,
      target: item.target.debug
    })
  }
}
