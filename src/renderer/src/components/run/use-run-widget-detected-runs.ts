import { useEffect, useState } from 'react'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { detectWorkspaceRunConfigurations } from './project-run-detection'

// Why module-level: every tab group mounts its own widget; reopening shows the last scan at once.
const lastScanByWorktree = new Map<string, DetectedRunConfiguration[]>()

/**
 * Runs detected across the workspace for the Run widget; null until the first scan finishes.
 * Scans only while the menu is open, so project files added since the last opening show up.
 */
export function useRunWidgetDetectedRuns(
  worktreeId: string,
  menuOpen: boolean
): DetectedRunConfiguration[] | null {
  const [scan, setScan] = useState<{ worktreeId: string; runs: DetectedRunConfiguration[] }>()
  useEffect(() => {
    if (!menuOpen) {
      return
    }
    let cancelled = false
    void detectWorkspaceRunConfigurations(worktreeId).then((runs) => {
      lastScanByWorktree.set(worktreeId, runs)
      if (!cancelled) {
        setScan({ worktreeId, runs })
      }
    })
    return () => {
      cancelled = true
    }
  }, [worktreeId, menuOpen])
  return scan?.worktreeId === worktreeId ? scan.runs : (lastScanByWorktree.get(worktreeId) ?? null)
}
