import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { runCommandText } from './run-dotnet-launcher'
import type { RunTarget } from './run-target'

export type RunTerminalIds = { tabId: string; leafId: string }

/**
 * Opens the terminal a run's command starts in, in the background so it never takes over the tab
 * group. `beforeCreate` gets the ids first: the terminal overlay must already know the tab is the
 * Run panel's on its first render, or it mounts the terminal in the tab group and remounts it.
 */
export function openRunTerminal(
  target: RunTarget,
  beforeCreate: (ids: RunTerminalIds) => void
): RunTerminalIds | null {
  const command = runCommandText(target)
  if (!command.trim()) {
    return null
  }
  const ids: RunTerminalIds = { tabId: createBrowserUuid(), leafId: createBrowserUuid() }
  beforeCreate(ids)
  const tab = useAppStore
    .getState()
    .createTab(target.worktreeId, target.groupId ?? undefined, undefined, {
      id: ids.tabId,
      activate: false,
      quickCommandLabel: target.command.label,
      initialLeafId: ids.leafId,
      pendingStartup: { command },
      ...(target.cwd ? { startupCwd: target.cwd } : {})
    })
  return { tabId: tab.id, leafId: ids.leafId }
}
