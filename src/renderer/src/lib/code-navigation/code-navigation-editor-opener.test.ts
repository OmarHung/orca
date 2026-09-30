import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The same module the public `monaco.Uri` re-exports, without loading the editor bundle.
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import { CODE_NAVIGATION_PREVIEW_SCHEME } from './code-navigation-preview-models'

const store = vi.hoisted(() => ({
  openFile: vi.fn(() => 'opened-tab'),
  setPendingEditorReveal: vi.fn()
}))
const workspace = vi.hoisted((): { sourceTab: unknown; openTab: unknown; root: string | null } => ({
  sourceTab: null,
  openTab: null,
  root: '/repo'
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))
vi.mock('./code-navigation-workspace', () => ({
  findEditTabForModelUri: (_state: unknown, modelUri: string) =>
    modelUri.endsWith('/src/app.ts') ? workspace.sourceTab : workspace.openTab,
  localWorkspaceRoot: () => workspace.root
}))

import { registerCodeNavigationEditorOpener } from './code-navigation-editor-opener'

type Opener = {
  openCodeEditor: (source: unknown, resource: URI, selectionOrPosition?: unknown) => boolean
}

function register(): Opener {
  let opener: Opener | null = null
  const fakeMonaco = {
    editor: {
      registerEditorOpener: (next: Opener) => {
        opener = next
        return { dispose: () => {} }
      }
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the opener only uses registerEditorOpener.
  registerCodeNavigationEditorOpener(fakeMonaco as never)
  return opener!
}

const sourceEditor = { getModel: () => ({ uri: URI.file('/repo/src/app.ts') }) }

beforeEach(() => {
  workspace.sourceTab = {
    worktreeId: 'wt-1',
    filePath: '/repo/src/app.ts',
    runtimeEnvironmentId: null
  }
  workspace.openTab = null
  workspace.root = '/repo'
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    callback()
    return 1
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('registerCodeNavigationEditorOpener', () => {
  it('opens a preview target as a tab of the source workspace and reveals the position', () => {
    const opener = register()
    const target = URI.file('/repo/src/lib/greeter.ts').with({
      scheme: CODE_NAVIGATION_PREVIEW_SCHEME
    })

    const handled = opener.openCodeEditor(sourceEditor, target, {
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 3,
      endColumn: 5
    })

    expect(handled).toBe(true)
    expect(store.openFile).toHaveBeenCalledWith(
      {
        filePath: '/repo/src/lib/greeter.ts',
        relativePath: 'src/lib/greeter.ts',
        worktreeId: 'wt-1',
        language: 'typescript',
        mode: 'edit',
        runtimeEnvironmentId: null
      },
      { suppressActiveRuntimeFallback: true }
    )
    expect(store.setPendingEditorReveal).toHaveBeenLastCalledWith({
      filePath: '/repo/src/lib/greeter.ts',
      fileId: 'opened-tab',
      line: 3,
      column: 5,
      matchLength: 0
    })
  })

  it('opens files outside the workspace by absolute path', () => {
    const opener = register()

    opener.openCodeEditor(sourceEditor, URI.file('/sdk/lib.dom.d.ts'), {
      lineNumber: 1,
      column: 1
    })

    expect(store.openFile).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/sdk/lib.dom.d.ts', relativePath: '/sdk/lib.dom.d.ts' }),
      expect.anything()
    )
  })

  it('reuses the path of a tab that already shows the target', () => {
    const opener = register()
    workspace.openTab = { filePath: '/repo/src/Lib.ts' }

    opener.openCodeEditor(sourceEditor, URI.file('/repo/src/lib.ts'), {
      lineNumber: 1,
      column: 1
    })

    expect(store.openFile).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/repo/src/Lib.ts', relativePath: 'src/Lib.ts' }),
      expect.anything()
    )
  })

  it('leaves same-model jumps, foreign schemes and unknown sources to Monaco', () => {
    const opener = register()

    expect(opener.openCodeEditor(sourceEditor, URI.file('/repo/src/app.ts'))).toBe(false)
    expect(opener.openCodeEditor(sourceEditor, URI.parse('https://example.com/a.ts'))).toBe(false)
    workspace.sourceTab = null
    expect(opener.openCodeEditor(sourceEditor, URI.file('/repo/src/other.ts'))).toBe(false)
    expect(store.openFile).not.toHaveBeenCalled()
  })
})
