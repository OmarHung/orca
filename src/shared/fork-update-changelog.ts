import type { ForkReleaseNote } from './fork-sync-status'

/** A commit this fork added since the previously launched build. */
export type ForkChangelogCommit = {
  sha: string
  subject: string
}

/** The AI summary, generated in the locale the renderer asked for. */
export type ForkChangelogSummary =
  | { status: 'generating'; locale: string }
  | { status: 'ready'; locale: string; markdown: string; agentLabel: string }
  | { status: 'failed'; locale: string; error: string }

/** What changed between the previously launched fork build and this one. */
export type ForkUpdateChangelog = {
  fromTag: string
  toTag: string
  /** Upstream releases after `fromTag` up to `toTag`, newest first. */
  releaseNotes: ForkReleaseNote[]
  /** Null when the previous build's commit is unknown or no longer in the checkout. */
  forkCommits: ForkChangelogCommit[] | null
  summary: ForkChangelogSummary | null
  /** False until the dialog that opens after the update is closed. */
  seen: boolean
  createdAt: number
}
