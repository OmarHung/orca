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
  /** Latest value per expression; empty while nothing is paused. */
  results: Record<string, WatchResult>
  add: (expression: string) => void
  remove: (expression: string) => void
  setResults: (results: Record<string, WatchResult>) => void
}

export const useWatchStore = create<WatchState>((set, get) => ({
  expressions: readWatches(),
  results: {},
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
    const { [expression]: _removed, ...results } = get().results
    set({ expressions, results })
    writeWatches(expressions)
  },
  setResults: (results) => set({ results })
}))
