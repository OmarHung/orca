import { readFile, stat } from 'node:fs/promises'
import {
  isCodeNavigationWatchedPath,
  type CodeNavigationFileChange,
  type CodeNavigationLocation,
  type CodeNavigationQuery,
  type CodeNavigationQueryResult,
  type CodeNavigationServerKind,
  type CodeNavigationStatusEvent
} from '../../shared/code-navigation/code-navigation-types'
import {
  LanguageServerSession,
  type LanguageServerLaunch,
  type LanguageServerSessionOptions
} from './language-server-session'

// Why: idle servers hold whole program graphs in memory; restarting one is cheap next to that.
const IDLE_SHUTDOWN_MS = 30 * 60_000
const IDLE_SWEEP_INTERVAL_MS = 60_000
// Why: every worktree gets its own server, and people keep many worktrees of one repo open.
const MAX_RUNNING_SESSIONS = 5
const MAX_PREVIEW_FILES = 100
const MAX_PREVIEW_BYTES = 1024 * 1024

export type CodeNavigationServiceDeps = {
  prepareLaunch: (
    kind: CodeNavigationServerKind,
    onDownloading: () => void
  ) => Promise<LanguageServerLaunch>
  createSession?: (options: LanguageServerSessionOptions) => LanguageServerSession
  readPreview?: (path: string) => Promise<string | null>
  now?: () => number
}

type SessionEntry = {
  kind: CodeNavigationServerKind
  root: string
  session: Promise<LanguageServerSession>
  /** Set once started, so notifications never wait on a starting server. */
  started: LanguageServerSession | null
  lastUsedAt: number
}

async function readPreviewFile(path: string): Promise<string | null> {
  try {
    if ((await stat(path)).size > MAX_PREVIEW_BYTES) {
      return null
    }
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function sessionKey(kind: CodeNavigationServerKind, root: string): string {
  return `${kind}\0${root}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns one language server per (kind, workspace root) and answers navigation queries. */
export class CodeNavigationService {
  private readonly sessions = new Map<string, SessionEntry>()
  private idleTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: CodeNavigationServiceDeps) {}

  async query(
    request: CodeNavigationQuery,
    emitStatus: (event: CodeNavigationStatusEvent) => void
  ): Promise<CodeNavigationQueryResult> {
    const key = sessionKey(request.kind, request.root)
    const existing = this.sessions.get(key)
    const entry = existing ?? this.startSession(request.kind, request.root, emitStatus)
    const status = (event: Omit<CodeNavigationStatusEvent, 'kind' | 'root'>): void => {
      // Why only the query that started the server reports: it owns the "starting" toast.
      if (!existing) {
        emitStatus({ kind: request.kind, root: request.root, ...event })
      }
    }
    this.touch(key, entry)
    try {
      const session = await entry.session
      const locations = await session.query(request.feature, request.document, request.position)
      const previews = await this.readPreviews(locations, request.document.path)
      status({ phase: 'ready' })
      return { ok: true, locations, previews }
    } catch (error) {
      status({ phase: 'failed', message: errorMessage(error) })
      return { ok: false, message: errorMessage(error) }
    } finally {
      this.touch(key, entry)
    }
  }

  closeDocument(kind: CodeNavigationServerKind, root: string, path: string): void {
    this.sessions.get(sessionKey(kind, root))?.started?.closeDocument(path)
  }

  filesChanged(root: string, changes: readonly CodeNavigationFileChange[]): void {
    for (const entry of this.sessions.values()) {
      if (entry.root !== root || !entry.started) {
        continue
      }
      const relevant = changes.filter((change) =>
        isCodeNavigationWatchedPath(entry.kind, change.path)
      )
      entry.started.filesChanged(relevant)
    }
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.sessions.values()]
    this.sessions.clear()
    this.stopIdleSweep()
    await Promise.all(entries.map((entry) => this.disposeEntry(entry)))
  }

  /** Stops servers nobody queried for a while. */
  async sweepIdle(): Promise<void> {
    const cutoff = this.now() - IDLE_SHUTDOWN_MS
    const idle = [...this.sessions.entries()].filter(([, entry]) => entry.lastUsedAt < cutoff)
    for (const [key] of idle) {
      this.sessions.delete(key)
    }
    if (this.sessions.size === 0) {
      this.stopIdleSweep()
    }
    await Promise.all(idle.map(([, entry]) => this.disposeEntry(entry)))
  }

  private startSession(
    kind: CodeNavigationServerKind,
    root: string,
    emitStatus: (event: CodeNavigationStatusEvent) => void
  ): SessionEntry {
    const key = sessionKey(kind, root)
    const createSession =
      this.deps.createSession ?? ((options) => new LanguageServerSession(options))
    const session = (async () => {
      const launch = await this.deps.prepareLaunch(kind, () =>
        emitStatus({ kind, root, phase: 'downloading' })
      )
      emitStatus({ kind, root, phase: 'starting' })
      const started = createSession({ root, launch })
      await started.whenReady()
      return started
    })()
    const entry: SessionEntry = { kind, root, session, started: null, lastUsedAt: this.now() }
    this.evictLeastRecentlyUsed(MAX_RUNNING_SESSIONS - 1)
    this.sessions.set(key, entry)
    this.ensureIdleSweep()
    session.then(
      (started) => {
        const current = this.sessions.get(key)
        if (current?.session !== session) {
          // Disposed or swept while starting.
          void started.dispose()
          return
        }
        this.sessions.set(key, { ...current, started })
        // Why: a crashed server is replaced by a fresh one on the next query.
        started.onExit(() => {
          if (this.sessions.get(key)?.started === started) {
            this.sessions.delete(key)
          }
        })
      },
      () => {
        // Why: a failed start is retried by the next query instead of being remembered.
        if (this.sessions.get(key)?.session === session) {
          this.sessions.delete(key)
        }
      }
    )
    return entry
  }

  private evictLeastRecentlyUsed(keep: number): void {
    const byAge = [...this.sessions.entries()].sort(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt)
    for (const [key, entry] of byAge.slice(0, Math.max(0, byAge.length - keep))) {
      this.sessions.delete(key)
      void this.disposeEntry(entry)
    }
  }

  private touch(key: string, entry: SessionEntry): void {
    const current = this.sessions.get(key)
    if (current && current.session === entry.session) {
      this.sessions.set(key, { ...current, lastUsedAt: this.now() })
    }
  }

  private async readPreviews(
    locations: readonly CodeNavigationLocation[],
    queriedPath: string
  ): Promise<Record<string, string>> {
    const read = this.deps.readPreview ?? readPreviewFile
    const paths = [...new Set(locations.map((location) => location.path))]
      .filter((path) => path !== queriedPath)
      .slice(0, MAX_PREVIEW_FILES)
    const contents = await Promise.all(paths.map(async (path) => [path, await read(path)] as const))
    return Object.fromEntries(
      contents.filter((entry): entry is readonly [string, string] => entry[1] !== null)
    )
  }

  private async disposeEntry(entry: SessionEntry): Promise<void> {
    try {
      await (await entry.session).dispose()
    } catch {
      // A session that never started has nothing to stop.
    }
  }

  private ensureIdleSweep(): void {
    if (this.idleTimer) {
      return
    }
    this.idleTimer = setInterval(() => void this.sweepIdle(), IDLE_SWEEP_INTERVAL_MS)
    this.idleTimer.unref?.()
  }

  private stopIdleSweep(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}
