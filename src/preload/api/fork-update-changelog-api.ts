import type { ForkUpdateChangelog } from '../../shared/fork-update-changelog'

export type ForkUpdateChangelogApi = {
  /** Null outside fork builds and before the first update. */
  get: () => Promise<ForkUpdateChangelog | null>
  /** Starts the AI summary in `locale` unless one is ready or running in it. */
  ensureSummary: (locale: string) => Promise<void>
  regenerate: (locale: string) => Promise<void>
  markSeen: () => Promise<void>
  onChanged: (callback: (changelog: ForkUpdateChangelog | null) => void) => () => void
}
