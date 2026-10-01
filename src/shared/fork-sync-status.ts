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

/** One upstream release's notes, as published on its GitHub release page. */
export type ForkReleaseNote = {
  tag: string
  title: string
  url: string
  publishedAt: string | null
  /** Markdown, cut short past a size cap; `url` has the full text. */
  body: string
}

/** A fork commit that conflicts when replayed onto the target tag, with its conflicted files. */
export type ForkSyncConflictCommit = {
  sha: string
  subject: string
  files: string[]
}

export type ForkSyncStatus =
  | {
      phase: 'available'
      baseTag: string
      targetTag: string
      /** Releases after the base up to the target, newest first; absent when unavailable. */
      releaseNotes?: ForkReleaseNote[]
    }
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
      /** Every fork commit a dry run found conflicting, in rebase order; absent when it could not run. */
      conflictCommits?: ForkSyncConflictCommit[]
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
