import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startStdioDapTransport, type StdioDapTransportSpec } from '../debug/dap-transport-stdio'
import type { DapTransport } from '../debug/dap-transport'
import { createLspConnection, type LspConnection } from './lsp-connection'
import { lspResultToLocations, type LspLocation } from './lsp-locations'
import { lspHoverToCodeNavigationHover } from './lsp-hover'
import type {
  CodeNavigationDocument,
  CodeNavigationFeature,
  CodeNavigationFileChange,
  CodeNavigationHover,
  CodeNavigationPosition
} from '../../shared/code-navigation/code-navigation-types'

const INITIALIZE_TIMEOUT_MS = 60_000
// Why long: a C# server loads the whole solution before it answers the first query.
const QUERY_TIMEOUT_MS = 120_000
const SHUTDOWN_TIMEOUT_MS = 2_000
const MAX_STDERR_CHARS = 4_000
const STDERR_LINES_IN_ERRORS = 3

const FEATURE_METHODS: Record<CodeNavigationFeature, string> = {
  definition: 'textDocument/definition',
  typeDefinition: 'textDocument/typeDefinition',
  references: 'textDocument/references',
  implementation: 'textDocument/implementation'
}

const FILE_CHANGE_TYPES: Record<CodeNavigationFileChange['kind'], number> = {
  create: 1,
  update: 2,
  delete: 3
}

export type LanguageServerLaunch = {
  program: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  /** Answers to `workspace/configuration`, by section; unlisted sections get null. */
  configuration?: Readonly<Record<string, unknown>>
}

export type LanguageServerSessionOptions = {
  root: string
  launch: LanguageServerLaunch
  startTransport?: (spec: StdioDapTransportSpec) => DapTransport
}

type SyncedDocument = { rendererVersion: number; serverVersion: number }

function toUri(path: string): string {
  return pathToFileURL(path).href
}

function configurationSections(params: unknown): unknown[] {
  if (typeof params !== 'object' || params === null || !('items' in params)) {
    return []
  }
  return Array.isArray(params.items)
    ? params.items.map((item: unknown) =>
        typeof item === 'object' && item !== null && 'section' in item ? item.section : undefined
      )
    : []
}

/** One language server process serving one workspace root. */
export class LanguageServerSession {
  private readonly connection: LspConnection
  private readonly documents = new Map<string, SyncedDocument>()
  private readonly initialized: Promise<void>
  private readonly rootUri: string
  private stderrTail = ''

  constructor(private readonly options: LanguageServerSessionOptions) {
    this.rootUri = toUri(options.root)
    const startTransport = options.startTransport ?? startStdioDapTransport
    const transport = startTransport({
      program: options.launch.program,
      args: options.launch.args,
      cwd: options.root,
      env: options.launch.env,
      onStderr: (text) => {
        this.stderrTail = (this.stderrTail + text).slice(-MAX_STDERR_CHARS)
      }
    })
    this.connection = createLspConnection(transport, (method, params) =>
      this.answerServerRequest(method, params)
    )
    this.initialized = this.initialize()
    // Why: every caller awaits `whenReady`, but a session disposed first must not leave it unhandled.
    this.initialized.catch(() => {})
  }

  /** Resolves once the server answered `initialize`; rejects with its stderr when it fails. */
  whenReady(): Promise<void> {
    return this.initialized
  }

  isExited(): boolean {
    return this.connection.isClosed()
  }

  onExit(listener: () => void): void {
    this.connection.onClose(() => listener())
  }

  async query(
    feature: CodeNavigationFeature,
    document: CodeNavigationDocument,
    position: CodeNavigationPosition
  ): Promise<LspLocation[]> {
    const extra = feature === 'references' ? { context: { includeDeclaration: true } } : {}
    return lspResultToLocations(
      await this.requestAt(FEATURE_METHODS[feature], document, position, extra)
    )
  }

  async hover(
    document: CodeNavigationDocument,
    position: CodeNavigationPosition
  ): Promise<CodeNavigationHover | null> {
    return lspHoverToCodeNavigationHover(
      await this.requestAt('textDocument/hover', document, position, {})
    )
  }

  /** A server-specific request, e.g. csharp-ls's `csharp/metadata`. */
  async request(method: string, params: unknown): Promise<unknown> {
    await this.initialized
    try {
      return await this.connection.request(method, params, { timeoutMs: QUERY_TIMEOUT_MS })
    } catch (error) {
      throw this.withStderr(error)
    }
  }

  closeDocument(path: string): void {
    const uri = toUri(path)
    if (this.documents.delete(uri)) {
      this.connection.notify('textDocument/didClose', { textDocument: { uri } })
    }
  }

  filesChanged(changes: readonly CodeNavigationFileChange[]): void {
    if (changes.length === 0) {
      return
    }
    const params = {
      changes: changes.map((change) => ({
        uri: toUri(change.path),
        type: FILE_CHANGE_TYPES[change.kind]
      }))
    }
    // Why after initialize: the protocol forbids notifications before the server is initialized.
    this.initialized.then(
      () => this.connection.notify('workspace/didChangeWatchedFiles', params),
      () => {}
    )
  }

  async dispose(): Promise<void> {
    if (this.connection.isClosed()) {
      return
    }
    try {
      await this.connection.request('shutdown', null, { timeoutMs: SHUTDOWN_TIMEOUT_MS })
      this.connection.notify('exit', null)
    } catch {
      // A server that cannot shut down cleanly is terminated below.
    }
    this.connection.close()
  }

  private async initialize(): Promise<void> {
    try {
      await this.connection.request(
        'initialize',
        {
          processId: process.pid,
          clientInfo: { name: 'Orca' },
          rootUri: this.rootUri,
          rootPath: this.options.root,
          workspaceFolders: [{ uri: this.rootUri, name: basename(this.options.root) }],
          capabilities: {
            general: { positionEncodings: ['utf-16'] },
            textDocument: {
              synchronization: { dynamicRegistration: false, didSave: false },
              definition: { linkSupport: true },
              typeDefinition: { linkSupport: true },
              references: {},
              implementation: { linkSupport: true },
              hover: { contentFormat: ['markdown', 'plaintext'] }
            },
            workspace: {
              workspaceFolders: true,
              configuration: true,
              didChangeWatchedFiles: { dynamicRegistration: true }
            }
          }
        },
        { timeoutMs: INITIALIZE_TIMEOUT_MS }
      )
      this.connection.notify('initialized', {})
    } catch (error) {
      this.connection.close()
      throw this.withStderr(error)
    }
  }

  private async requestAt(
    method: string,
    document: CodeNavigationDocument,
    position: CodeNavigationPosition,
    extra: Record<string, unknown>
  ): Promise<unknown> {
    await this.initialized
    this.syncDocument(document)
    return this.request(method, { textDocument: { uri: toUri(document.path) }, position, ...extra })
  }

  private syncDocument(document: CodeNavigationDocument): void {
    const uri = toUri(document.path)
    // Why: a leading BOM character hides a Razor view's first-line `@model` from csharp-ls, which
    // then answers nothing anywhere in the view. Monaco drops it already; this keeps it that way.
    const text = document.text.replace(/^\uFEFF/, '')
    const synced = this.documents.get(uri)
    if (!synced) {
      this.connection.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: document.languageId, version: 1, text }
      })
      this.documents.set(uri, { rendererVersion: document.version, serverVersion: 1 })
      return
    }
    if (synced.rendererVersion === document.version) {
      return
    }
    // Why Orca's own counter: Monaco's version restarts when a model is recreated, and LSP
    // versions must only grow.
    const serverVersion = synced.serverVersion + 1
    this.connection.notify('textDocument/didChange', {
      textDocument: { uri, version: serverVersion },
      contentChanges: [{ text }]
    })
    this.documents.set(uri, { rendererVersion: document.version, serverVersion })
  }

  private answerServerRequest(method: string, params: unknown): unknown {
    switch (method) {
      case 'workspace/configuration': {
        // Why nulls: servers fall back to their defaults for every unset section.
        const configuration = this.options.launch.configuration ?? {}
        return configurationSections(params).map((section) =>
          typeof section === 'string' && Object.hasOwn(configuration, section)
            ? configuration[section]
            : null
        )
      }
      case 'workspace/workspaceFolders':
        return [{ uri: this.rootUri, name: basename(this.options.root) }]
      case 'client/registerCapability':
      case 'client/unregisterCapability':
      case 'window/workDoneProgress/create':
      case 'window/showMessageRequest':
        return null
      default:
        throw new Error(`Unhandled server request ${method}`)
    }
  }

  private withStderr(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error)
    const lastLines = this.stderrTail
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-STDERR_LINES_IN_ERRORS)
      .join(' ')
    return new Error(lastLines && this.connection.isClosed() ? `${message}: ${lastLines}` : message)
  }
}
