import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The same module the public `monaco.Uri` re-exports, without loading the editor bundle.
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import { CODE_NAVIGATION_PREVIEW_SCHEME } from './code-navigation-preview-models'

const context = vi.hoisted((): { current: unknown } => ({ current: null }))

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('./code-navigation-workspace', () => ({
  resolveCodeNavigationContext: () => context.current
}))

import { registerCodeNavigationProviders } from './code-navigation-providers'

type Provider = (...args: unknown[]) => Promise<unknown>

class FakeRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number
  ) {}
}

const TEXT = 'import { greet } from "./greeter"\ngreet("x")\n'

function fakeModel(path: string, language = 'typescript') {
  return {
    uri: URI.file(path),
    getLanguageId: () => language,
    getValueLength: () => TEXT.length,
    getVersionId: () => 7,
    getValue: () => TEXT,
    isDisposed: () => false,
    getOffsetAt: () => 35,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 })
  }
}

function setup(workerEntries: unknown[] = []) {
  const providers = new Map<string, Provider>()
  const models = new Map<string, unknown>()
  const register =
    (feature: string, method: string) => (language: string, provider: Record<string, Provider>) => {
      providers.set(`${language}:${feature}`, provider[method])
      return { dispose: () => {} }
    }
  const worker = {
    getDefinitionAtPosition: vi.fn(async () => workerEntries),
    getReferencesAtPosition: vi.fn(async () => workerEntries)
  }
  const defaults = () => ({
    modeConfiguration: { definitions: true, references: true, hovers: true },
    setModeConfiguration: vi.fn()
  })
  const monaco = {
    Uri: URI,
    Range: FakeRange,
    typescript: {
      typescriptDefaults: defaults(),
      javascriptDefaults: defaults(),
      getTypeScriptWorker: async () => async () => worker,
      getJavaScriptWorker: async () => async () => worker
    },
    languages: {
      registerDefinitionProvider: register('definition', 'provideDefinition'),
      registerReferenceProvider: register('references', 'provideReferences'),
      registerImplementationProvider: register('implementation', 'provideImplementation')
    },
    editor: {
      getModel: (uri: URI) => models.get(uri.toString()) ?? null,
      getModels: () => [...models.values()],
      createModel: (value: string, _language: string, uri: URI) => {
        const model = { uri, value, isAttachedToEditor: () => false, dispose: () => {} }
        models.set(uri.toString(), model)
        return model
      }
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the providers only use the members faked above.
  registerCodeNavigationProviders(monaco as never)
  const token = { isCancellationRequested: false }
  const call = (language: string, feature: string, model: ReturnType<typeof fakeModel>) => {
    models.set(model.uri.toString(), model)
    const provider = providers.get(`${language}:${feature}`)!
    return feature === 'references'
      ? provider(model, { lineNumber: 2, column: 2 }, {}, token)
      : provider(model, { lineNumber: 2, column: 2 }, token)
  }
  return { monaco, providers, models, worker, call }
}

const query = vi.fn()

// Why strings: URI objects cache their formatted form, so equal URIs can differ structurally.
function asStrings(locations: unknown): { uri: string; range: unknown }[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: providers return Monaco locations.
  return (locations as { uri: URI; range: unknown }[]).map((location) => ({
    uri: location.uri.toString(),
    range: location.range
  }))
}

beforeEach(() => {
  context.current = null
  query.mockReset()
  vi.stubGlobal('window', { api: { codeNavigation: { query } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('registerCodeNavigationProviders', () => {
  it('replaces the TS worker navigation for every routed language', () => {
    const { monaco, providers } = setup()

    expect(monaco.typescript.typescriptDefaults.setModeConfiguration).toHaveBeenCalledWith({
      definitions: false,
      references: false,
      hovers: true
    })
    expect(monaco.typescript.javascriptDefaults.setModeConfiguration).toHaveBeenCalled()
    expect([...providers.keys()].sort()).toEqual(
      ['csharp', 'javascript', 'typescript']
        .flatMap((language) => [
          `${language}:definition`,
          `${language}:implementation`,
          `${language}:references`
        ])
        .sort()
    )
  })

  it('asks the language server and previews targets that have no tab', async () => {
    const { call, models } = setup()
    context.current = {
      kind: 'typescript',
      languageId: 'typescript',
      root: '/repo',
      tab: { filePath: '/repo/app.ts' }
    }
    query.mockResolvedValue({
      ok: true,
      locations: [
        {
          path: '/repo/app.ts',
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }
        },
        {
          path: '/repo/greeter.ts',
          range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } }
        }
      ],
      previews: { '/repo/greeter.ts': 'export function greet() {}' }
    })

    const locations = await call('typescript', 'definition', fakeModel('/repo/app.ts'))

    expect(query).toHaveBeenCalledWith({
      kind: 'typescript',
      root: '/repo',
      feature: 'definition',
      document: { path: '/repo/app.ts', languageId: 'typescript', version: 7, text: TEXT },
      position: { line: 1, character: 1 }
    })
    const previewUri = URI.file('/repo/greeter.ts')
      .with({ scheme: CODE_NAVIGATION_PREVIEW_SCHEME })
      .toString()
    expect(asStrings(locations)).toEqual([
      { uri: URI.file('/repo/app.ts').toString(), range: new FakeRange(2, 1, 2, 6) },
      { uri: previewUri, range: new FakeRange(1, 17, 1, 22) }
    ])
    expect(models.has(previewUri)).toBe(true)
  })

  it('keeps the TS worker in-file answers where no server runs', async () => {
    const model = fakeModel('/remote/app.ts')
    const { call } = setup([
      { fileName: model.uri.toString(), textSpan: { start: 9, length: 5 } },
      { fileName: 'file:///remote/greeter.ts', textSpan: { start: 0, length: 5 } }
    ])

    const locations = await call('typescript', 'references', model)

    expect(query).not.toHaveBeenCalled()
    expect(asStrings(locations)).toEqual([
      { uri: model.uri.toString(), range: new FakeRange(1, 10, 1, 15) }
    ])
  })

  it('falls back to the TS worker when the server fails', async () => {
    const model = fakeModel('/repo/app.ts')
    const { call, worker } = setup([])
    context.current = {
      kind: 'typescript',
      languageId: 'typescript',
      root: '/repo',
      tab: { filePath: '/repo/app.ts' }
    }
    query.mockResolvedValue({ ok: false, message: 'server exited' })

    await call('typescript', 'definition', model)

    expect(worker.getDefinitionAtPosition).toHaveBeenCalled()
  })

  it('has nothing to offer for C# without a server', async () => {
    const { call } = setup()

    await expect(
      call('csharp', 'implementation', fakeModel('/remote/App.cs', 'csharp'))
    ).resolves.toBeUndefined()
  })
})
