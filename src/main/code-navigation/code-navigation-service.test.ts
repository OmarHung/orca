import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { CodeNavigationService } from './code-navigation-service'
import type { LanguageServerSession } from './language-server-session'
import type { LspLocation } from './lsp-locations'
import type {
  CodeNavigationQuery,
  CodeNavigationStatusEvent
} from '../../shared/code-navigation/code-navigation-types'

const root = join(process.cwd(), 'workspace')
const queried = join(root, 'src', 'app.ts')
const other = join(root, 'src', 'lib.ts')
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }

function query(overrides: Partial<CodeNavigationQuery> = {}): CodeNavigationQuery {
  return {
    kind: 'typescript',
    root,
    feature: 'definition',
    document: { path: queried, languageId: 'typescript', version: 1, text: '' },
    position: { line: 0, character: 0 },
    ...overrides
  }
}

type FakeSession = {
  whenReady: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
  hover: ReturnType<typeof vi.fn>
  request: ReturnType<typeof vi.fn>
  closeDocument: ReturnType<typeof vi.fn>
  filesChanged: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
}

const at = (path: string): LspLocation => ({ uri: pathToFileURL(path).href, range })

function fakeSession(locations: LspLocation[] = []): FakeSession {
  return {
    whenReady: vi.fn(async () => {}),
    query: vi.fn(async () => locations),
    hover: vi.fn(async () => ({ contents: ['**hover**'] })),
    request: vi.fn(async () => null),
    closeDocument: vi.fn(),
    filesChanged: vi.fn(),
    dispose: vi.fn(async () => {}),
    onExit: vi.fn()
  }
}

function createService(options: {
  sessions: FakeSession[]
  prepareLaunch?: ConstructorParameters<typeof CodeNavigationService>[0]['prepareLaunch']
  previews?: Record<string, string | null>
  now?: () => number
  installed?: boolean
  metadataDir?: string
}) {
  const created: FakeSession[] = []
  const service = new CodeNavigationService({
    prepareLaunch: options.prepareLaunch ?? (async () => ({ program: 'x', args: [], env: {} })),
    isInstalled: async () => options.installed ?? true,
    metadataDir: options.metadataDir,
    createSession: () => {
      const next = options.sessions[created.length]
      created.push(next)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake implements every method the service calls.
      return next as unknown as LanguageServerSession
    },
    readPreview: async (path) => options.previews?.[path] ?? null,
    now: options.now
  })
  return { service, created }
}

describe('CodeNavigationService', () => {
  it('starts one server per kind and root and reports its start to the first query only', async () => {
    const { service, created } = createService({ sessions: [fakeSession(), fakeSession()] })
    const firstStatus: CodeNavigationStatusEvent[] = []
    const laterStatus: CodeNavigationStatusEvent[] = []

    await service.query(query(), (event) => firstStatus.push(event))
    await service.query(query(), (event) => laterStatus.push(event))
    await service.query(query({ kind: 'csharp' }), () => {})

    expect(created).toHaveLength(2)
    expect(firstStatus.map((event) => event.phase)).toEqual(['starting', 'ready'])
    expect(laterStatus).toEqual([])
  })

  it('reports a download before starting when the server is not installed yet', async () => {
    const { service } = createService({
      sessions: [fakeSession()],
      prepareLaunch: async (_kind, onDownloading) => {
        onDownloading()
        return { program: 'x', args: [], env: {} }
      }
    })
    const phases: string[] = []

    await service.query(query(), (event) => phases.push(event.phase))

    expect(phases).toEqual(['downloading', 'starting', 'ready'])
  })

  it('returns previews for other target files only', async () => {
    const session = fakeSession([at(queried), at(other), at(other), at(join(root, 'too-big.ts'))])
    const { service } = createService({
      sessions: [session],
      previews: { [queried]: 'self', [other]: 'export const lib = 1' }
    })

    const result = await service.query(query(), () => {})

    expect(result).toEqual({
      ok: true,
      locations: expect.any(Array),
      previews: { [other]: 'export const lib = 1' }
    })
  })

  it('reports a failed start and retries it on the next query', async () => {
    let attempts = 0
    const { service, created } = createService({
      sessions: [fakeSession()],
      prepareLaunch: async () => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('dotnet was not found on PATH')
        }
        return { program: 'x', args: [], env: {} }
      }
    })
    const status: CodeNavigationStatusEvent[] = []

    const failed = await service.query(query(), (event) => status.push(event))
    const retried = await service.query(query(), () => {})

    expect(failed).toEqual({ ok: false, message: 'dotnet was not found on PATH' })
    expect(status.at(-1)).toMatchObject({
      phase: 'failed',
      message: 'dotnet was not found on PATH'
    })
    expect(retried.ok).toBe(true)
    expect(created).toHaveLength(1)
  })

  it('forwards only the file changes a server kind watches', async () => {
    const session = fakeSession()
    const { service } = createService({ sessions: [session] })
    await service.query(query(), () => {})

    service.filesChanged(root, [
      { kind: 'update', path: other },
      { kind: 'update', path: join(root, 'Program.cs') }
    ])
    service.filesChanged(join(process.cwd(), 'elsewhere'), [{ kind: 'update', path: other }])

    expect(session.filesChanged).toHaveBeenCalledTimes(1)
    expect(session.filesChanged).toHaveBeenCalledWith([{ kind: 'update', path: other }])
  })

  it('closes documents on the running server', async () => {
    const session = fakeSession()
    const { service } = createService({ sessions: [session] })
    await service.query(query(), () => {})

    service.closeDocument('typescript', root, queried)
    service.closeDocument('csharp', root, queried)

    expect(session.closeDocument).toHaveBeenCalledTimes(1)
  })

  it('stops servers that sat idle and starts a fresh one afterwards', async () => {
    let now = 0
    const { service, created } = createService({
      sessions: [fakeSession(), fakeSession()],
      now: () => now
    })
    await service.query(query(), () => {})

    now = 29 * 60_000
    await service.sweepIdle()
    expect(created[0].dispose).not.toHaveBeenCalled()

    now = 31 * 60_000
    await service.sweepIdle()
    expect(created[0].dispose).toHaveBeenCalled()

    await service.query(query(), () => {})
    expect(created).toHaveLength(2)
    await service.disposeAll()
    expect(created[1].dispose).toHaveBeenCalled()
  })

  it('stops the least recently used server beyond five running ones', async () => {
    let now = 0
    const sessions = Array.from({ length: 6 }, () => fakeSession())
    const { service, created } = createService({ sessions, now: () => now })

    for (let index = 0; index < 6; index += 1) {
      now = index
      await service.query(query({ root: join(root, `wt-${index}`) }), () => {})
    }

    expect(created[0].dispose).toHaveBeenCalled()
    expect(created.slice(1).every((session) => !session.dispose.mock.calls.length)).toBe(true)
  })

  it('opens decompiled C# as a read-only file and drops schemes it cannot open', async () => {
    const metadataDir = await mkdtemp(join(tmpdir(), 'orca-metadata-'))
    try {
      const metadataUri = 'csharp:/repo/App/App.csproj/decompiled/System.Console.cs'
      const session = fakeSession([
        { uri: metadataUri, range },
        { uri: metadataUri, range },
        { uri: 'bundled:///libs/lib.dom.d.ts', range }
      ])
      session.request.mockResolvedValue({
        projectName: 'App',
        assemblyName: 'System.Console',
        symbolName: 'System.Console',
        source: 'public static class Console {}'
      })
      const { service } = createService({ sessions: [session], metadataDir })

      const result = await service.query(query({ kind: 'csharp' }), () => {})

      expect(result.ok).toBe(true)
      const locations = result.ok ? result.locations : []
      expect(locations).toHaveLength(2)
      expect(locations[0].path).toMatch(/System\.Console\.cs$/)
      expect(await readFile(locations[0].path, 'utf8')).toBe('public static class Console {}')
      expect(session.request).toHaveBeenCalledTimes(1)
      expect(session.request).toHaveBeenCalledWith('csharp/metadata', {
        textDocument: { uri: metadataUri }
      })
    } finally {
      await rm(metadataDir, { recursive: true, force: true })
    }
  })

  it('hovers through an installed server without reporting its start', async () => {
    const session = fakeSession()
    const { service, created } = createService({ sessions: [session] })
    const { feature: _feature, ...hoverQuery } = query()

    const result = await service.hover(hoverQuery)

    expect(result).toEqual({ ok: true, hover: { contents: ['**hover**'] } })
    expect(created).toHaveLength(1)
  })

  it('never starts a server for a hover when it would need a download', async () => {
    const { service, created } = createService({ sessions: [fakeSession()], installed: false })
    const { feature: _feature, ...hoverQuery } = query()

    const result = await service.hover(hoverQuery)

    expect(result.ok).toBe(false)
    expect(created).toHaveLength(0)
  })
})
