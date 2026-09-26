import { useEffect, useState } from 'react'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { detectWorkspaceRunConfigurations } from './project-run-detection'

/** Runs detected across the workspace; null while scanning. Rescans when the workspace changes. */
export function useWorkspaceDetectedRuns(
  worktreeId: string | null
): DetectedRunConfiguration[] | null {
  const [result, setResult] = useState<{
    worktreeId: string
    runs: DetectedRunConfiguration[]
  }>()
  useEffect(() => {
    if (!worktreeId) {
      return
    }
    let cancelled = false
    void detectWorkspaceRunConfigurations(worktreeId).then((runs) => {
      if (!cancelled) {
        setResult({ worktreeId, runs })
      }
    })
    return () => {
      cancelled = true
    }
  }, [worktreeId])
  return result && result.worktreeId === worktreeId ? result.runs : null
}
