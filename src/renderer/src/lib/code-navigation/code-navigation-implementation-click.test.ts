import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/shortcut-platform', () => ({ getShortcutPlatform: () => 'darwin' }))

import {
  installImplementationClick,
  isImplementationClick
} from './code-navigation-implementation-click'

const click = { button: 0, metaKey: true, ctrlKey: false, altKey: true, shiftKey: false }

describe('isImplementationClick', () => {
  it('matches Cmd+Alt+click on macOS and Ctrl+Alt+click elsewhere', () => {
    expect(isImplementationClick(click, 'darwin')).toBe(true)
    expect(isImplementationClick({ ...click, metaKey: false, ctrlKey: true }, 'win32')).toBe(true)
    expect(isImplementationClick({ ...click, metaKey: false, ctrlKey: true }, 'darwin')).toBe(false)
    expect(isImplementationClick(click, 'linux')).toBe(false)
  })

  it('ignores plain Cmd+click, Shift and other buttons', () => {
    expect(isImplementationClick({ ...click, altKey: false }, 'darwin')).toBe(false)
    expect(isImplementationClick({ ...click, shiftKey: true }, 'darwin')).toBe(false)
    expect(isImplementationClick({ ...click, button: 2 }, 'darwin')).toBe(false)
  })
})

describe('installImplementationClick', () => {
  let now = 0
  beforeEach(() => {
    vi.stubGlobal('performance', { now: () => now })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setup(options: { isEditorTab?: boolean; position?: unknown } = {}) {
    const onNavigate = vi.fn()
    const listeners = new Map<string, (event: unknown) => void>()
    const node = {
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type)
    }
    const editor = {
      getContainerDomNode: () => node,
      getTargetAtClientPoint: vi.fn(() =>
        'position' in options
          ? { position: options.position }
          : { position: { lineNumber: 3, column: 5 } }
      ),
      setPosition: vi.fn(),
      focus: vi.fn(),
      trigger: vi.fn()
    }
    const dispose = installImplementationClick(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only uses the members faked above.
      editor as never,
      () => options.isEditorTab ?? true,
      onNavigate
    )
    const fire = (type: string, extra: Record<string, unknown> = {}) => {
      const event = {
        ...click,
        clientX: 10,
        clientY: 20,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...extra
      }
      listeners.get(type)?.(event)
      return event
    }
    return { editor, fire, dispose, listeners, onNavigate }
  }

  it('jumps to the implementation under the pointer and swallows the whole gesture', () => {
    const { editor, fire, onNavigate } = setup()

    const down = fire('pointerdown')
    const mouseDown = fire('mousedown')
    const up = fire('pointerup')
    const mouseUp = fire('mouseup')

    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 3, column: 5 })
    expect(editor.trigger).toHaveBeenCalledWith('mouse', 'editor.action.goToImplementation', null)
    expect(onNavigate).toHaveBeenCalledOnce()
    for (const event of [down, mouseDown, up, mouseUp]) {
      expect(event.stopPropagation).toHaveBeenCalled()
    }
  })

  it('leaves other clicks, non-tab editors and empty spots to Monaco', () => {
    const plain = setup()
    const event = plain.fire('pointerdown', { altKey: false })
    plain.fire('pointerup', { altKey: false })
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(plain.editor.trigger).not.toHaveBeenCalled()

    const diff = setup({ isEditorTab: false })
    diff.fire('pointerdown')
    expect(diff.editor.trigger).not.toHaveBeenCalled()

    const empty = setup({ position: null })
    empty.fire('pointerdown')
    expect(empty.editor.trigger).not.toHaveBeenCalled()
  })

  it('stops swallowing mouse events shortly after the gesture', () => {
    const { fire } = setup()
    fire('pointerdown')
    fire('pointerup')

    now = 1_000
    expect(fire('mousedown').stopPropagation).not.toHaveBeenCalled()
  })

  it('removes its listeners on dispose', () => {
    const { dispose, listeners } = setup()
    dispose()
    expect(listeners.size).toBe(0)
  })
})
