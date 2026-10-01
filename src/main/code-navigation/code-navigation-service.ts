import {
  isCodeNavigationWatchedPath,
  type CodeNavigationFileChange,
  type CodeNavigationHoverQuery,
  type CodeNavigationHoverResult,
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
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import { writeCsharpMetadataFile } from './csharp-metadata-files'
import {
  readTargetPreviews,
  toFileLocations,
  type MetadataFileResolver
} from './navigation-target-files'
import { serverLocations, type ServerLocationDeps } from './code-navigation-server-locations'
import { CodeNavigationRouter } from './code-navigation-routing'

// Why: idle servers hold whole program graphs in memory; restarting one is cheap next to that.
const IDLE_SHUTDOWN_MS = 30 * 60_000
const IDLE_SWEEP_INTERVAL_MS = 60_000
// Why: every worktree gets its own server, and people keep many worktrees of one repo open.
const MAX_RUNNING_SESSIONS = 5

export type CodeNavigationServiceDeps = {
  prepareLaunch: (
    kind: CodeNavigationServerKind,
    root: string,
    onDownloading: () => void
  ) => Promise<LanguageServerLaunch>
  /** Whether starting this kind needs no download; hovering never downloads. */
  isInstalled: (kind: CodeNavigationServerKind) => Promise<boolean>
  /** Where decompiled C# sources are written; without it they cannot be opened. */
  metadataDir?: string
  createSession?: (options: LanguageServerSessionOptions) => LanguageServerSession
  router?: CodeNavigationRouter
  now?: () => number
} & ServerLocationDeps

type SessionEntry = {
  kind: CodeNavigationServerKind
  root: string
  session: Promise<LanguageServerSession>
  /** Set once started, so notifications never wait on a starting server. */
  started: LanguageServerSession | null
  lastUsedAt: number
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
  private readonly explicitlyActivated = new Set<string>()
  private readonly router: CodeNavigationRouter
  private idleTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: CodeNavigationServiceDeps) {
    this.router = deps.router ?? new CodeNavigationRouter()
  }

  async query(
    rendererRequest: CodeNavigationQuery,
    emitStatus: (event: CodeNavigationStatusEvent) => void
  ): Promise<CodeNavigationQueryResult> {
    const { kind, root, nuxt } = await this.routeOf(rendererRequest)
    const request = { ...rendererRequest, kind, root }
    if (request.userInitiated && (await this.router.needsNuxtHint({ kind, root, nuxt }))) {
      emitStatus({ kind, root, phase: 'nuxtTypesMissing' })
    }
    const key = sessionKey(request.kind, request.root)
    const existing = this.sessions.get(key)
    if (!existing && !request.userInitiated && !this.explicitlyActivated.has(key)) {
      return { ok: false, message: 'Code navigation requires an explicit navigation action' }
    }
    if (request.userInitiated) {
      this.explicitlyActivated.add(key)
    }
    const entry = existing ?? this.startSession(request.kind, request.root, emitStatus)
    // Why: a query that joins a server still starting (one a prewarm or hover began) shows the
    // loading toast too, instead of a jump that seems to do nothing.
    const joinsStartingServer = existing !== undefined && existing.started === null
    const status = (event: Omit<CodeNavigationStatusEvent, 'kind' | 'root'>): void => {
      if (!existing || joinsStartingServer) {
        emitStatus({ kind: request.kind, root: request.root, ...event })
      }
    }
    if (joinsStartingServer) {
      status({ phase: 'starting' })
    }
    this.touch(key, entry)
    try {
      const session = await entry.session
      const locations = await toFileLocations(
        await serverLocations(session, request, nuxt, this.deps),
        this.metadataResolver(session)
      )
      const previews = await readTargetPreviews(
        locations,
        request.document.path,
        this.deps.readPreview
      )
      status({ phase: 'ready' })
      return { ok: true, locations, previews }
    } catch (error) {
      status({ phase: 'failed', message: errorMessage(error) })
      return { ok: false, message: errorMessage(error) }
    } finally {
      this.touch(key, entry)
    }
  }

  /**
   * Hover info from a running server. It may restart an activated, installed server but never
   * downloads one; before activation the renderer keeps Monaco's own hover.
   */
  async hover(rendererRequest: CodeNavigationHoverQuery): Promise<CodeNavigationHoverResult> {
    const { kind, root } = await this.routeOf(rendererRequest)
    const request = { ...rendererRequest, kind, root }
    const key = sessionKey(request.kind, request.root)
    let entry = this.sessions.get(key)
    if (!entry) {
      if (!this.explicitlyActivated.has(key)) {
        return { ok: false, message: 'Code navigation has not been activated for this workspace' }
      }
      const installed = await this.deps.isInstalled(request.kind).catch(() => false)
      if (!installed) {
        return { ok: false, message: 'The language server is not installed' }
      }
      entry = this.sessions.get(key) ?? this.startSession(request.kind, request.root, () => {})
    }
    this.touch(key, entry)
    try {
      const session = await entry.session
      return { ok: true, hover: await session.hover(request.document, request.position) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    } finally {
      this.touch(key, entry)
    }
  }

  /**
   * Restarts an activated, installed server in the background and has it compile. Like hover, it
   * never downloads and cannot activate a workspace.
   */
  async warm(request: Omit<CodeNavigationHoverQuery, 'position'>): Promise<void> {
    // Why a hover at the top: it needs the semantic model, so the project loads and compiles now.
    await this.hover({ ...request, position: { line: 0, character: 0 } })
  }

  closeDocument(kind: CodeNavigationServerKind, root: string, path: string): void {
    const route = this.router.closeDocument(kind, root, path)
    this.sessions.get(sessionKey(route.kind, route.root))?.started?.closeDocument(path)
  }

  filesChanged(root: string, changes: readonly CodeNavigationFileChange[]): void {
    this.router.filesChanged(changes)
    for (const entry of this.sessions.values()) {
      // Why inside: a Vue server is rooted at its package, below the watched workspace root.
      if (!entry.started || !isPathInsideOrEqual(root, entry.root)) {
        continue
      }
      const relevant = changes.filter(
        (change) =>
          isCodeNavigationWatchedPath(entry.kind, change.path) &&
          isPathInsideOrEqual(entry.root, change.path)
      )
      entry.started.filesChanged(relevant)
    }
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.sessions.values()]
    this.sessions.clear()
    this.explicitlyActivated.clear()
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
      const launch = await this.deps.prepareLaunch(kind, root, () =>
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

  private routeOf(request: CodeNavigationHoverQuery) {
    return this.router.route(request.kind, request.root, request.document.path)
  }

  private metadataResolver(session: LanguageServerSession): MetadataFileResolver | null {
    const { metadataDir } = this.deps
    return metadataDir
      ? (uri) =>
          writeCsharpMetadataFile(metadataDir, uri, (method, params) =>
            session.request(method, params)
          )
      : null
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
