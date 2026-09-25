import {
  FORK_SYNC_STAGE_PERCENT,
  type ForkSyncStage,
  type ForkSyncStatus
} from '../../shared/fork-sync-status'
import type { UpdateStatus } from '../../shared/update-status-types'
import type { ForkSourceIdentity } from './fork-source-identity'
import { compareReleaseTags, pickLatestReleaseTag } from './fork-source-release-tags'
import type { ForkSyncEvent } from './fork-sync-events'

export type ForkSyncRunResult = {
  code: number | null
  /** Last lines of output, for failure reports. */
  outputTail: string
}

export type ForkSourceUpdaterDeps = {
  identity: ForkSourceIdentity
  publish: (status: UpdateStatus) => void
  /** `git ls-remote --tags --refs <upstream>` output. */
  listUpstreamTags: () => Promise<string>
  runSync: (
    targetTag: string,
    onEvent: (event: ForkSyncEvent) => void
  ) => Promise<ForkSyncRunResult>
  installLocalBuild: (manifestPath: string) => Promise<void>
}

/**
 * Owns update status for a build made from this fork's source: "available" means upstream has a
 * newer release tag, and "updating" re-stacks the fork onto it, rebuilds, and installs the result.
 * `getStatus()` is null once ownership is handed to the regular local-build installer.
 */
export class ForkSourceUpdater {
  private status: UpdateStatus | null = null
  private busy = false

  constructor(private readonly deps: ForkSourceUpdaterDeps) {}

  getStatus(): UpdateStatus | null {
    return this.status
  }

  /** True when "download"/"install" requests belong to this updater. */
  ownsActions(): boolean {
    return this.status !== null && this.status.forkSync !== undefined
  }

  async check(userInitiated: boolean): Promise<void> {
    if (this.busy) {
      return
    }
    this.busy = true
    if (userInitiated) {
      this.set({ state: 'checking', userInitiated: true })
    }
    try {
      const latest = pickLatestReleaseTag(await this.deps.listUpstreamTags())
      const baseTag = this.deps.identity.baseTag
      if (!latest || compareReleaseTags(latest, baseTag) <= 0) {
        this.set({ state: 'not-available', userInitiated })
        return
      }
      this.setFork(
        { state: 'available', version: latest, changelog: null },
        {
          phase: 'available',
          baseTag,
          targetTag: latest
        }
      )
    } catch (error) {
      if (userInitiated) {
        this.set({
          state: 'error',
          message: `Could not check upstream releases: ${errorMessage(error)}`,
          retryable: true,
          userInitiated: true
        })
      }
    } finally {
      this.busy = false
    }
  }

  /** Starts the sync from an available/conflict/failed state; false when nothing to start. */
  startSync(): boolean {
    const fork = this.status?.forkSync
    if (this.busy || !fork || fork.phase === 'syncing' || fork.phase === 'built') {
      return false
    }
    void this.runSync(fork.baseTag, fork.targetTag)
    return true
  }

  /** Installs a finished build; false when there is none. */
  install(): boolean {
    const fork = this.status?.forkSync
    if (this.busy || fork?.phase !== 'built') {
      return false
    }
    // Why release ownership first: the local-build installer now drives status to "Restart".
    this.status = null
    void this.deps.installLocalBuild(fork.manifestPath)
    return true
  }

  dismiss(): void {
    if (!this.busy) {
      this.set({ state: 'idle' })
      this.status = null
    }
  }

  private async runSync(baseTag: string, targetTag: string): Promise<void> {
    this.busy = true
    let stage: ForkSyncStage = 'fetch'
    let conflict: Extract<ForkSyncEvent, { type: 'conflict' }> | null = null
    let manifestPath: string | null = null
    const publishStage = (): void =>
      this.setFork(
        { state: 'downloading', percent: FORK_SYNC_STAGE_PERCENT[stage], version: targetTag },
        { phase: 'syncing', baseTag, targetTag, stage }
      )
    publishStage()
    try {
      const result = await this.deps.runSync(targetTag, (event) => {
        if (event.type === 'stage') {
          stage = event.stage
          publishStage()
        } else if (event.type === 'conflict') {
          conflict = event
        } else {
          manifestPath = event.manifestPath
        }
      })
      this.finishSync({ baseTag, targetTag, stage, conflict, manifestPath, result })
    } catch (error) {
      this.publishFailure(baseTag, targetTag, stage, errorMessage(error))
    } finally {
      this.busy = false
    }
  }

  private finishSync(outcome: {
    baseTag: string
    targetTag: string
    stage: ForkSyncStage
    conflict: Extract<ForkSyncEvent, { type: 'conflict' }> | null
    manifestPath: string | null
    result: ForkSyncRunResult
  }): void {
    const { baseTag, targetTag, stage, conflict, manifestPath, result } = outcome
    if (conflict) {
      const subject = conflict.commitSubject ? `"${conflict.commitSubject}"` : 'A fork commit'
      this.setFork(
        {
          state: 'error',
          message: `${subject} conflicts with ${targetTag} in ${conflict.files.length} file(s). The branch was left unchanged.`,
          version: targetTag,
          retryable: true,
          userInitiated: true
        },
        {
          phase: 'conflict',
          baseTag: conflict.baseTag,
          targetTag,
          repoRoot: conflict.worktree,
          branch: this.deps.identity.branch,
          files: conflict.files,
          commitSubject: conflict.commitSubject
        }
      )
      return
    }
    if (result.code === 0 && manifestPath) {
      this.setFork(
        { state: 'downloaded', version: targetTag },
        { phase: 'built', baseTag, targetTag, manifestPath }
      )
      return
    }
    this.publishFailure(baseTag, targetTag, stage, result.outputTail)
  }

  private publishFailure(
    baseTag: string,
    targetTag: string,
    stage: ForkSyncStage | null,
    logTail: string
  ): void {
    this.setFork(
      {
        state: 'error',
        message: `Syncing to ${targetTag} failed${stage ? ` during ${stage}` : ''}.`,
        version: targetTag,
        retryable: true,
        userInitiated: true
      },
      { phase: 'failed', baseTag, targetTag, repoRoot: this.deps.identity.repoRoot, stage, logTail }
    )
  }

  private setFork(status: UpdateStatus, forkSync: ForkSyncStatus): void {
    this.set({ ...status, forkSync })
  }

  private set(status: UpdateStatus): void {
    this.status = status
    this.deps.publish(status)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
