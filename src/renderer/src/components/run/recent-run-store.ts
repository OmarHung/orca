import { create } from 'zustand'
import { normalizeDebugLaunchTarget } from '../../../../shared/run-configurations/run-configuration-definition'
import type { RunTarget } from './run-configuration-control'

const STORAGE_KEY = 'orca.run.recentByWorktree.v1'
/** JetBrains keeps five temporary configurations per project. */
export const MAX_RECENT_RUNS = 5

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null
}

function readTarget(value: unknown): RunTarget | null {
  const record = asRecord(value)
  const command = asRecord(record?.command)
  if (
    !record ||
    !command ||
    typeof record.worktreeId !== 'string' ||
    typeof record.commandKey !== 'string' ||
    typeof command.id !== 'string' ||
    typeof command.label !== 'string' ||
    typeof command.command !== 'string' ||
    typeof command.appendEnter !== 'boolean' ||
    (record.cwd !== undefined && typeof record.cwd !== 'string')
  ) {
    return null
  }
  const debug = record.debug === undefined ? undefined : normalizeDebugLaunchTarget(record.debug)
  if (debug === null) {
    return null
  }
  return {
    worktreeId: record.worktreeId,
    groupId: null,
    commandKey: record.commandKey,
    command: {
      id: command.id,
      label: command.label,
      command: command.command,
      appendEnter: command.appendEnter
    },
    ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}),
    ...(debug ? { debug } : {})
  }
}

export function readStoredRecentRuns(): Record<string, RunTarget[]> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value = asRecord(raw ? JSON.parse(raw) : null)
    const result: Record<string, RunTarget[]> = {}
    for (const [worktreeId, list] of Object.entries(value ?? {})) {
      if (!Array.isArray(list)) {
        continue
      }
      const targets = list
        .map(readTarget)
        .filter((entry): entry is RunTarget => entry !== null)
        .slice(0, MAX_RECENT_RUNS)
      if (targets.length > 0) {
        result[worktreeId] = targets
      }
    }
    return result
  } catch {
    return {}
  }
}

/** Newest first, one entry per configuration, capped like JetBrains' temporary configurations. */
export function addRecentRun(list: readonly RunTarget[], target: RunTarget): RunTarget[] {
  return [target, ...list.filter((entry) => entry.commandKey !== target.commandKey)].slice(
    0,
    MAX_RECENT_RUNS
  )
}

type RecentRunState = {
  recentByWorktree: Record<string, RunTarget[]>
  remember: (target: RunTarget) => void
}

// Why localStorage: recent runs are a per-machine convenience that must survive a restart,
// and quick commands' shared shape must stay unchanged for mobile/older clients.
export const useRecentRunStore = create<RecentRunState>((set, get) => ({
  recentByWorktree: readStoredRecentRuns(),
  remember: (target) => {
    // Why no group: tab groups are per session; runs open in the group the user clicks from.
    const stored: RunTarget = { ...target, groupId: null }
    const recentByWorktree = {
      ...get().recentByWorktree,
      [target.worktreeId]: addRecentRun(get().recentByWorktree[target.worktreeId] ?? [], stored)
    }
    set({ recentByWorktree })
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recentByWorktree))
    } catch {
      // Storage can be unavailable; the list then lasts only for this window.
    }
  }
}))
