import type { ForkReleaseNote } from '../../shared/fork-sync-status'
import type {
  ForkChangelogCommit,
  ForkChangelogSummary,
  ForkUpdateChangelog
} from '../../shared/fork-update-changelog'
import type { ChangelogAgentResult } from './fork-update-changelog-agent'
import type { ForkChangelogFile, ForkChangelogLaunch } from './fork-update-changelog-file'

export type ForkChangelogServiceDeps = {
  /** This build: its base tag and, for local builds, the commit stamped into its version. */
  current: ForkChangelogLaunch
  readFile: () => ForkChangelogFile
  writeFile: (file: ForkChangelogFile) => void
  fetchReleaseNotes: (fromTag: string, toTag: string) => Promise<ForkReleaseNote[]>
  listForkCommits: (input: {
    fromTag: string
    fromCommit: string | null
    toTag: string
    toCommit: string | null
  }) => Promise<ForkChangelogCommit[] | null>
  summarize: (changelog: ForkUpdateChangelog, locale: string) => Promise<ChangelogAgentResult>
  publish: (changelog: ForkUpdateChangelog | null) => void
  now: () => number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The changelog shown after a fork build updates to a new upstream tag. Each launch records the
 * running build; when the base tag differs from the last launch, the gap gets a changelog whose
 * AI summary is written in whatever locale the renderer asks for.
 */
export class ForkUpdateChangelogService {
  private changelog: ForkUpdateChangelog | null = null
  private preparing: Promise<void> = Promise.resolve()
  /** Identifies the newest summary run, so a superseded run cannot overwrite its result. */
  private activeRun: { locale: string; token: symbol } | null = null

  constructor(private readonly deps: ForkChangelogServiceDeps) {}

  start(): void {
    const file = this.deps.readFile()
    const previous = file.lastLaunch
    const { current } = this.deps
    this.changelog = file.changelog
    this.deps.writeFile({ lastLaunch: current, changelog: this.changelog })
    if (previous && previous.baseTag !== current.baseTag) {
      this.preparing = this.prepare(previous)
    }
  }

  async get(): Promise<ForkUpdateChangelog | null> {
    await this.preparing
    return this.changelog
  }

  /** Starts the summary when it is missing, in another locale, or was cut off by a quit. */
  async ensureSummary(locale: string): Promise<void> {
    await this.preparing
    const summary = this.changelog?.summary ?? null
    const inFlight = this.activeRun?.locale === locale
    const needsRun =
      summary === null ||
      summary.locale !== locale ||
      (summary.status === 'generating' && !inFlight)
    if (this.changelog && needsRun) {
      this.summarize(locale)
    }
  }

  async regenerate(locale: string): Promise<void> {
    await this.preparing
    if (this.changelog && this.activeRun?.locale !== locale) {
      this.summarize(locale)
    }
  }

  markSeen(): void {
    if (this.changelog && !this.changelog.seen) {
      this.update({ ...this.changelog, seen: true })
    }
  }

  private async prepare(previous: ForkChangelogLaunch): Promise<void> {
    const { current } = this.deps
    const [releaseNotes, forkCommits] = await Promise.all([
      this.deps.fetchReleaseNotes(previous.baseTag, current.baseTag).catch((error: unknown) => {
        console.warn('[fork-update-changelog] release notes unavailable:', errorMessage(error))
        return []
      }),
      this.deps
        .listForkCommits({
          fromTag: previous.baseTag,
          fromCommit: previous.commit,
          toTag: current.baseTag,
          toCommit: current.commit
        })
        .catch(() => null)
    ])
    this.update({
      fromTag: previous.baseTag,
      toTag: current.baseTag,
      releaseNotes,
      forkCommits,
      summary: null,
      seen: false,
      createdAt: this.deps.now()
    })
  }

  private summarize(locale: string): void {
    const changelog = this.changelog
    if (!changelog) {
      return
    }
    const token = Symbol(locale)
    this.activeRun = { locale, token }
    this.setSummary({ status: 'generating', locale })
    void this.deps
      .summarize(changelog, locale)
      .catch((error: unknown): ChangelogAgentResult => ({ ok: false, error: errorMessage(error) }))
      .then((result) => {
        if (this.activeRun?.token !== token) {
          return
        }
        this.activeRun = null
        this.setSummary(
          result.ok
            ? { status: 'ready', locale, markdown: result.markdown, agentLabel: result.agentLabel }
            : { status: 'failed', locale, error: result.error }
        )
      })
  }

  private setSummary(summary: ForkChangelogSummary): void {
    if (this.changelog) {
      this.update({ ...this.changelog, summary })
    }
  }

  private update(changelog: ForkUpdateChangelog): void {
    this.changelog = changelog
    this.deps.writeFile({ lastLaunch: this.deps.current, changelog })
    this.deps.publish(changelog)
  }
}
