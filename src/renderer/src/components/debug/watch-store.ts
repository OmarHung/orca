import { create } from 'zustand'
import type { EvaluateResult } from './debug-protocol-readers'

const STORAGE_KEY = 'orca.debug.watches.v1'

export type WatchResult = { ok: true; result: EvaluateResult } | { ok: false; message: string }

function readWatches(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      : []
  } catch {
    return []
  }
}

function writeWatches(watches: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(watches))
  } catch {
    // Storage can be unavailable; watches then last only for this window.
  }
}

type WatchState = {
  /** Watch expressions, kept across sessions like JetBrains'. */
  expressions: string[]
  /** sessionId → latest value per expression; empty while that session runs. */
  resultsBySession: Record<string, Record<string, WatchResult>>
  add: (expression: string) => void
  remove: (expression: string) => void
  setResults: (sessionId: string, results: Record<string, WatchResult>) => void
}

export const useWatchStore = create<WatchState>((set, get) => ({
  expressions: readWatches(),
  resultsBySession: {},
  add: (expression) => {
    const trimmed = expression.trim()
    if (!trimmed || get().expressions.includes(trimmed)) {
      return
    }
    const expressions = [...get().expressions, trimmed]
    set({ expressions })
    writeWatches(expressions)
  },
  remove: (expression) => {
    const expressions = get().expressions.filter((entry) => entry !== expression)
    const resultsBySession = Object.fromEntries(
      Object.entries(get().resultsBySession).map(([sessionId, results]) => {
        const { [expression]: _removed, ...rest } = results
        return [sessionId, rest]
      })
    )
    set({ expressions, resultsBySession })
    writeWatches(expressions)
  },
  setResults: (sessionId, results) =>
    set({ resultsBySession: { ...get().resultsBySession, [sessionId]: results } })
}))
