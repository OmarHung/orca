import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requests = vi.hoisted((): { next: unknown } => ({ next: null }))
vi.mock('./code-navigation-providers', () => ({ serverRequestFor: () => requests.next }))

import { installCodeNavigationPrewarm, prewarmCodeNavigation } from './code-navigation-prewarm'

const warm = vi.fn(async () => {})
const document = { path: '/shop/App.cs', languageId: 'csharp', version: 1, text: 'using System;' }
const csharp = (root: string) => ({
  kind: 'csharp',
  root,
  document,
  position: { line: 0, character: 0 }
})
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: prewarm hands the model to the mocked request builder only.
const model = {} as never

beforeEach(() => {
  vi.stubGlobal('window', { api: { codeNavigation: { warm } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('prewarmCodeNavigation', () => {
  it('warms a C# project once a minute at most', () => {
    requests.next = csharp('/shop-a')

    prewarmCodeNavigation(model, 1_000)
    prewarmCodeNavigation(model, 30_000)
    prewarmCodeNavigation(model, 70_000)

    expect(warm).toHaveBeenCalledTimes(2)
    expect(warm).toHaveBeenCalledWith({ kind: 'csharp', root: '/shop-a', document })
  })

  it('keeps projects apart and leaves TypeScript and non-server files alone', () => {
    requests.next = csharp('/shop-b')
    prewarmCodeNavigation(model, 1_000)
    requests.next = csharp('/shop-c')
    prewarmCodeNavigation(model, 1_000)
    requests.next = { ...csharp('/web'), kind: 'typescript' }
    prewarmCodeNavigation(model, 1_000)
    requests.next = null
    prewarmCodeNavigation(model, 1_000)

    expect(warm.mock.calls.map(([request]) => request.root)).toEqual(['/shop-b', '/shop-c'])
  })
})

describe('installCodeNavigationPrewarm', () => {
  it('warms when an editor shows a file and when it takes focus', () => {
    const handlers: Record<string, () => void> = {}
    let onCreate: ((editor: unknown) => void) | null = null
    const fakeMonaco = {
      editor: {
        onDidCreateEditor: (listener: (editor: unknown) => void) => {
          onCreate = listener
          return { dispose: () => {} }
        }
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: prewarm only uses onDidCreateEditor.
    installCodeNavigationPrewarm(fakeMonaco as never)
    onCreate?.({
      getModel: () => model,
      onDidChangeModel: (handler: () => void) => {
        handlers.model = handler
      },
      onDidFocusEditorText: (handler: () => void) => {
        handlers.focus = handler
      }
    })

    requests.next = csharp('/shop-d')
    handlers.model?.()
    requests.next = csharp('/shop-e')
    handlers.focus?.()

    expect(warm.mock.calls.map(([request]) => request.root)).toEqual(['/shop-d', '/shop-e'])
  })
})
