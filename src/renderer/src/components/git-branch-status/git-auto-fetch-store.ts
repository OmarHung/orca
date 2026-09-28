import { create } from 'zustand'

export type GitAutoFetchRecord = {
  lastAttemptAt: number
  /** Set when the last attempt failed; cleared by the next success. */
  error: string | null
}

type GitAutoFetchState = {
  recordsByRepo: Record<string, GitAutoFetchRecord>
  runningRepoIds: Record<string, true>
  markStarted: (repoId: string, at: number) => void
  markFinished: (repoId: string, at: number, error: string | null) => void
}

/** In-memory history of automatic fetches, keyed by repository (worktrees share its refs). */
export const useGitAutoFetchStore = create<GitAutoFetchState>((set) => ({
  recordsByRepo: {},
  runningRepoIds: {},
  markStarted: (repoId, at) =>
    set((state) => ({
      runningRepoIds: { ...state.runningRepoIds, [repoId]: true },
      recordsByRepo: {
        ...state.recordsByRepo,
        [repoId]: { lastAttemptAt: at, error: state.recordsByRepo[repoId]?.error ?? null }
      }
    })),
  markFinished: (repoId, at, error) =>
    set((state) => {
      const { [repoId]: _finished, ...stillRunning } = state.runningRepoIds
      return {
        runningRepoIds: stillRunning,
        recordsByRepo: { ...state.recordsByRepo, [repoId]: { lastAttemptAt: at, error } }
      }
    })
}))
