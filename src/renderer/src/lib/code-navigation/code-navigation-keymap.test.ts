import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const opener = vi.hoisted(() => ({ openNavigationTarget: vi.fn() }))
const tabs = vi.hoisted(() => ({ paths: new Set<string>() }))

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('@/components/editor/editor-shortcuts', () => ({
  editorShortcutMatches: (id: string, event: KeyboardEvent) =>
    ({
      'editor.goToDeclaration': 'b',
      'editor.navigateBack': '[',
      'editor.navigateForward': ']'
    })[id] === event.key && event.metaKey
}))
vi.mock('./code-navigation-editor-opener', () => opener)
vi.mock('./code-navigation-workspace', () => ({
  editorNavigationLocation: (
    _state: unknown,
    editor: { path: string; getPosition: () => { lineNumber: number; column: number } }
  ) =>
    tabs.paths.has(editor.path)
      ? {
          worktreeId: 'wt-keymap',
          runtimeEnvironmentId: null,
          filePath: editor.path,
          line: editor.getPosition().lineNumber,
          column: editor.getPosition().column
        }
      : null
}))

import { installCodeNavigationKeymap } from './code-navigation-keymap'
import { codeNavigationHistory } from './code-navigation-history'

type Handler = () => void

function fakeEditor(path: string) {
  const handlers: Record<string, Handler[]> = {}
  const on = (name: string) => (handler: Handler) => {
    handlers[name] = [...(handlers[name] ?? []), handler]
    return { dispose: () => {} }
  }
  let position = { lineNumber: 1, column: 1 }
  let textFocus = false
  const editor = {
    path,
    onDidFocusEditorText: on('focus'),
    onDidBlurEditorText: on('blur'),
    onDidChangeModel: on('model'),
    onDidChangeCursorPosition: on('cursor'),
    onDidDispose: on('dispose'),
    hasTextFocus: () => textFocus,
    getPosition: () => position,
    setPosition: vi.fn((next: { lineNumber: number; column: number }) => {
      position = next
    }),
    revealPositionInCenterIfOutsideViewport: vi.fn(),
    getContainerDomNode: () => ({ addEventListener: () => {}, removeEventListener: () => {} }),
    trigger: vi.fn(),
    focus() {
      textFocus = true
      for (const handler of handlers.focus ?? []) {
        handler()
      }
    },
    blur() {
      textFocus = false
      for (const handler of handlers.blur ?? []) {
        handler()
      }
    },
    moveTo(lineNumber: number) {
      position = { lineNumber, column: 1 }
      for (const handler of handlers.cursor ?? []) {
        handler()
      }
    }
  }
  return editor
}

let keydown: ((event: KeyboardEvent) => void) | null = null
const setCodeEditorFocused = vi.fn()

function setup() {
  let onCreate: ((editor: unknown) => void) | null = null
  const fakeMonaco = {
    editor: {
      onDidCreateEditor: (listener: (editor: unknown) => void) => {
        onCreate = listener
        return { dispose: () => {} }
      }
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the keymap only uses onDidCreateEditor.
  const dispose = installCodeNavigationKeymap(fakeMonaco as never)
  const create = (path: string) => {
    const editor = fakeEditor(path)
    onCreate?.(editor)
    return editor
  }
  return { create, dispose }
}

function press(key: string, options: { repeat?: boolean } = {}) {
  const event = {
    key,
    metaKey: true,
    repeat: options.repeat ?? false,
    isComposing: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only these fields.
  keydown?.(event as unknown as KeyboardEvent)
  return event
}

beforeEach(() => {
  tabs.paths = new Set(['/a.ts', '/b.ts'])
  vi.stubGlobal('window', {
    api: { codeNavigation: { setCodeEditorFocused } },
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      if (type === 'keydown') {
        keydown = listener
      }
    },
    removeEventListener: () => {
      keydown = null
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('installCodeNavigationKeymap', () => {
  it('tells main when an editor tab gains and loses focus, but not for other editors', () => {
    const { create, dispose } = setup()
    const sqlConsole = create('/sql-console')
    const tab = create('/a.ts')

    sqlConsole.focus()
    expect(setCodeEditorFocused).not.toHaveBeenCalled()
    tab.focus()
    tab.blur()

    expect(setCodeEditorFocused.mock.calls).toEqual([[true], [false]])
    dispose()
  })

  it('runs Monaco navigation for a claimed chord and swallows the key', () => {
    const { create, dispose } = setup()
    const tab = create('/a.ts')

    expect(press('b').preventDefault).not.toHaveBeenCalled()
    tab.focus()
    const event = press('b')
    press('b', { repeat: true })
    press('x')

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(tab.trigger).toHaveBeenCalledTimes(1)
    expect(tab.trigger).toHaveBeenCalledWith('keyboard', 'editor.action.revealDefinition', null)
    dispose()
  })

  it('steps back within a file and opens another file for a cross-file step', () => {
    const { create, dispose } = setup()
    const a = create('/a.ts')
    const b = create('/b.ts')
    a.focus()
    a.moveTo(12)
    codeNavigationHistory.recordJump({
      worktreeId: 'wt-keymap',
      runtimeEnvironmentId: null,
      filePath: '/a.ts',
      line: 12,
      column: 1
    })
    a.moveTo(40)

    press('[')
    expect(a.setPosition).toHaveBeenCalledWith({ lineNumber: 12, column: 1 })

    a.blur()
    b.focus()
    press('[')
    expect(opener.openNavigationTarget).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/a.ts' }),
      '/a.ts',
      { lineNumber: 12, column: 1 }
    )
    dispose()
  })
})
