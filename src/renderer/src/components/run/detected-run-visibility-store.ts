import { create } from 'zustand'

const STORAGE_KEY = 'orca.run.hiddenDetectedByRepo.v1'
const MAX_HIDDEN_PER_REPO = 500

export function readStoredHiddenDetectedRuns(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {}
    }
    const result: Record<string, string[]> = {}
    for (const [repoId, keys] of Object.entries(value)) {
      if (Array.isArray(keys)) {
        const valid = keys.filter((key): key is string => typeof key === 'string')
        if (valid.length > 0) {
          result[repoId] = valid.slice(0, MAX_HIDDEN_PER_REPO)
        }
      }
    }
    return result
  } catch {
    return {}
  }
}

type DetectedRunVisibilityState = {
  /** Hide keys of detected runs and projects, per repo so every worktree of it agrees. */
  hiddenByRepo: Record<string, string[]>
  hide: (repoId: string, key: string) => void
  show: (repoId: string, keys: readonly string[]) => void
}

function withRepo(
  hiddenByRepo: Record<string, string[]>,
  repoId: string,
  keys: string[]
): Record<string, string[]> {
  const rest = Object.fromEntries(Object.entries(hiddenByRepo).filter(([id]) => id !== repoId))
  return keys.length > 0 ? { ...rest, [repoId]: keys } : rest
}

function persist(hiddenByRepo: Record<string, string[]>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hiddenByRepo))
  } catch {
    // Storage can be unavailable; hiding then lasts only for this window.
  }
}

// Why localStorage: like recent runs, hiding is a per-machine view preference, not repo config.
export const useDetectedRunVisibilityStore = create<DetectedRunVisibilityState>((set, get) => ({
  hiddenByRepo: readStoredHiddenDetectedRuns(),
  hide: (repoId, key) => {
    const current = get().hiddenByRepo[repoId] ?? []
    if (current.includes(key)) {
      return
    }
    const hiddenByRepo = withRepo(
      get().hiddenByRepo,
      repoId,
      [...current, key].slice(-MAX_HIDDEN_PER_REPO)
    )
    set({ hiddenByRepo })
    persist(hiddenByRepo)
  },
  show: (repoId, keys) => {
    const shown = new Set(keys)
    const remaining = (get().hiddenByRepo[repoId] ?? []).filter((key) => !shown.has(key))
    const hiddenByRepo = withRepo(get().hiddenByRepo, repoId, remaining)
    set({ hiddenByRepo })
    persist(hiddenByRepo)
  }
}))
