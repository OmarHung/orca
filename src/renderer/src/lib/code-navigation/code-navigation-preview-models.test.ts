import { afterEach, describe, expect, it, vi } from 'vitest'
// The same module the public `monaco.Uri` re-exports, without loading the editor bundle.
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import {
  CODE_NAVIGATION_PREVIEW_SCHEME,
  filePathForNavigationUri,
  installCodeNavigationPreviewModelCleanup,
  navigationUriForPath,
  sweepIdlePreviewModels
} from './code-navigation-preview-models'
import {
  markMonacoPeekReferencesClosed,
  markMonacoPeekReferencesOpen
} from '../monaco-peek-references-lifecycle'

type FakeModel = {
  uri: URI
  value: string
  language: string
  attached: boolean
  disposed: boolean
  getValue: () => string
  setValue: (value: string) => void
  isAttachedToEditor: () => boolean
  dispose: () => void
}

function fakeMonaco() {
  const models = new Map<string, FakeModel>()
  const add = (uri: URI, value: string, language = 'typescript'): FakeModel => {
    const model: FakeModel = {
      uri,
      value,
      language,
      attached: false,
      disposed: false,
      getValue: () => model.value,
      setValue: (next) => {
        model.value = next
      },
      isAttachedToEditor: () => model.attached,
      dispose: () => {
        model.disposed = true
        models.delete(uri.toString())
      }
    }
    models.set(uri.toString(), model)
    return model
  }
  const monaco = {
    Uri: URI,
    editor: {
      getModel: (uri: URI) => models.get(uri.toString()) ?? null,
      getModels: () => [...models.values()],
      createModel: (value: string, language: string, uri: URI) => add(uri, value, language)
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the module only uses these members.
  return { monaco: monaco as never, models, add }
}

describe('navigationUriForPath', () => {
  it('points at the open tab model when there is one', () => {
    const { monaco, add, models } = fakeMonaco()
    add(URI.file('/repo/src/lib.ts'), 'open tab text')

    const uri = navigationUriForPath(monaco, '/repo/src/lib.ts', 'disk text')

    expect(uri.scheme).toBe('file')
    expect(models.size).toBe(1)
  })

  it('creates or refreshes a preview model for files without a tab', () => {
    const { monaco, models } = fakeMonaco()

    const first = navigationUriForPath(monaco, '/repo/src/lib.cs', 'v1')
    const second = navigationUriForPath(monaco, '/repo/src/lib.cs', 'v2')

    expect(first.scheme).toBe(CODE_NAVIGATION_PREVIEW_SCHEME)
    expect(second.toString()).toBe(first.toString())
    const [model] = models.values()
    expect(model.value).toBe('v2')
    expect(model.language).toBe('csharp')
  })

  it('falls back to the file URI when no preview text came back', () => {
    const { monaco, models } = fakeMonaco()

    expect(navigationUriForPath(monaco, '/repo/huge.ts', undefined).scheme).toBe('file')
    expect(models.size).toBe(0)
  })
})

afterEach(() => vi.useRealTimers())

describe('filePathForNavigationUri', () => {
  it('maps file and preview URIs back to the file path', () => {
    const file = URI.file('/repo/src/lib.ts')
    expect(filePathForNavigationUri(file)).toBe(file.fsPath)
    expect(filePathForNavigationUri(file.with({ scheme: CODE_NAVIGATION_PREVIEW_SCHEME }))).toBe(
      file.fsPath
    )
    expect(filePathForNavigationUri(URI.parse('https://example.com/a.ts'))).toBeNull()
  })
})

describe('sweepIdlePreviewModels', () => {
  it('disposes idle, unattached preview models only', () => {
    const { monaco, models, add } = fakeMonaco()
    add(URI.file('/repo/tab.ts'), 'tab')
    navigationUriForPath(monaco, '/repo/idle.ts', 'idle', 0)
    navigationUriForPath(monaco, '/repo/shown.ts', 'shown', 0)
    navigationUriForPath(monaco, '/repo/recent.ts', 'recent', 4 * 60_000)
    const shown = [...models.values()].find((model) => model.value === 'shown')!
    shown.attached = true

    sweepIdlePreviewModels(monaco, 5 * 60_000)

    expect([...models.values()].map((model) => model.value).sort()).toEqual([
      'recent',
      'shown',
      'tab'
    ])
  })

  it('sweeps an idle preview without waiting for another navigation query', () => {
    vi.useFakeTimers()
    const { monaco, models } = fakeMonaco()
    const uri = navigationUriForPath(monaco, '/repo/idle.ts', 'idle')
    const model = models.get(uri.toString())
    if (!model) {
      throw new Error('preview model was not created')
    }

    vi.advanceTimersByTime(5 * 60_000)

    expect(model.disposed).toBe(true)
  })

  it('reschedules for the exact remaining idle time after a preview refresh', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { monaco, models } = fakeMonaco()
    const uri = navigationUriForPath(monaco, '/repo/refreshed.ts', 'v1')
    const model = models.get(uri.toString())
    if (!model) {
      throw new Error('preview model was not created')
    }

    vi.advanceTimersByTime(4 * 60_000)
    navigationUriForPath(monaco, '/repo/refreshed.ts', 'v2')
    vi.advanceTimersByTime(4 * 60_000 + 59_999)
    expect(model.disposed).toBe(false)

    vi.advanceTimersByTime(1)
    expect(model.disposed).toBe(true)
  })

  it('keeps every result alive until its peek window closes', () => {
    vi.useFakeTimers()
    const { monaco, models } = fakeMonaco()
    const referenceWidget = {}
    const disposeCleanup = installCodeNavigationPreviewModelCleanup(monaco)
    const first = navigationUriForPath(monaco, '/repo/first.ts', 'first')
    const second = navigationUriForPath(monaco, '/repo/second.ts', 'second')
    markMonacoPeekReferencesOpen(referenceWidget)

    vi.advanceTimersByTime(5 * 60_000)
    expect(models.get(first.toString())?.disposed).toBe(false)
    expect(models.get(second.toString())?.disposed).toBe(false)

    markMonacoPeekReferencesClosed(referenceWidget)
    expect(models.has(first.toString())).toBe(false)
    expect(models.has(second.toString())).toBe(false)
    disposeCleanup()
  })
})
