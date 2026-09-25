/**
 * Status of a fork build's "sync with upstream and rebuild" update. Rides on UpdateStatus as an
 * optional field, so clients that do not know it simply render the base update state.
 */
export type ForkSyncStage = 'fetch' | 'rebase' | 'install' | 'verify' | 'push' | 'build'

export const FORK_SYNC_STAGES: readonly ForkSyncStage[] = [
  'fetch',
  'rebase',
  'install',
  'verify',
  'push',
  'build'
]

export type ForkSyncStatus =
  | { phase: 'available'; baseTag: string; targetTag: string }
  | { phase: 'syncing'; baseTag: string; targetTag: string; stage: ForkSyncStage }
  /** Rebuilt; installing hands the manifest to Orca's local-build installer. */
  | { phase: 'built'; baseTag: string; targetTag: string; manifestPath: string }
  | {
      phase: 'conflict'
      baseTag: string
      targetTag: string
      repoRoot: string
      branch: string
      files: string[]
      /** Subject of this fork's commit that no longer applies cleanly. */
      commitSubject: string | null
    }
  | {
      phase: 'failed'
      baseTag: string
      targetTag: string
      repoRoot: string
      stage: ForkSyncStage | null
      /** Last lines of the sync output, for the error card. */
      logTail: string
    }

/** Stage share of the progress bar; build dominates wall-clock time. */
export const FORK_SYNC_STAGE_PERCENT: Record<ForkSyncStage, number> = {
  fetch: 2,
  rebase: 8,
  install: 15,
  verify: 30,
  push: 45,
  build: 55
}
