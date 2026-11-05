import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requests = vi.hoisted((): { next: { kind: string; root: string } | null } => ({ next: null }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('./code-navigation-workspace', () => ({
  resolveCodeNavigationContext: () => requests.next
}))
vi.mock('./code-navigation-providers', () => ({
  serverRequestFor: () => requests.next && { ...requests.next, document, position: {} }
}))

import { installCodeNavigationPrewarm, prewarmCodeNavigation } from './code-navigation-prewarm'
import { CodeNavigationActivation } from './code-navigation-activation'

const warm = vi.fn(async (_request: { kind: string; root: string; document: unknown }) => {})
const document = { path: '/shop/App.cs', languageId: 'csharp', version: 1, text: 'using System;' }
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: prewarm reads only the mocked context by uri.
const model = { uri: { toString: () => 'file:///shop/App.cs' } } as never
const activation = new CodeNavigationActivation()

beforeEach(() => {
  vi.stubGlobal('window', { api: { codeNavigation: { warm } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('prewarmCodeNavigation', () => {
  it('warms a project once a minute at most', () => {
    requests.next = { kind: 'csharp', root: '/shop-a' }

    prewarmCodeNavigation(model, activation, 1_000)
    prewarmCodeNavigation(model, activation, 30_000)
    prewarmCodeNavigation(model, activation, 70_000)

    expect(warm).toHaveBeenCalledTimes(2)
    expect(warm).toHaveBeenCalledWith({ kind: 'csharp', root: '/shop-a', document })
  })

  it('warms every server language without an earlier jump, and skips files with no server', () => {
    const fresh = new CodeNavigationActivation()
    requests.next = { kind: 'csharp', root: '/shop-b' }
    prewarmCodeNavigation(model, fresh, 1_000)
    requests.next = { kind: 'typescript', root: '/web' }
    prewarmCodeNavigation(model, fresh, 1_000)
    requests.next = { kind: 'vue', root: '/web/front' }
    prewarmCodeNavigation(model, fresh, 1_000)
    requests.next = null
    prewarmCodeNavigation(model, fresh, 1_000)

    expect(warm.mock.calls.map(([request]) => request.root)).toEqual([
      '/shop-b',
      '/web',
      '/web/front'
    ])
    expect(fresh.isWorkspaceActivated('typescript', '/web')).toBe(true)
  })
})

describe('installCodeNavigationPrewarm', () => {
  it('warms when an editor shows a file and when it takes focus', () => {
    const handlers: Record<string, () => void> = {}
    const created: { listener: ((editor: unknown) => void) | null } = { listener: null }
    const fakeMonaco = {
      editor: {
        onDidCreateEditor: (listener: (editor: unknown) => void) => {
          created.listener = listener
          return { dispose: () => {} }
        }
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: prewarm only uses onDidCreateEditor.
    installCodeNavigationPrewarm(fakeMonaco as never, activation)
    created.listener?.({
      getModel: () => model,
      onDidChangeModel: (handler: () => void) => {
        handlers.model = handler
      },
      onDidFocusEditorText: (handler: () => void) => {
        handlers.focus = handler
      }
    })

    requests.next = { kind: 'csharp', root: '/shop-d' }
    handlers.model?.()
    requests.next = { kind: 'csharp', root: '/shop-e' }
    handlers.focus?.()

    expect(warm.mock.calls.map(([request]) => request.root)).toEqual(['/shop-d', '/shop-e'])
  })
})
