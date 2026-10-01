import { beforeEach, describe, expect, it, vi } from 'vitest'

type Sender = {
  id: number
  once: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
}
type FocusListener = (event: { sender: Sender }, focused: unknown) => void

const electron = vi.hoisted(() => ({
  on: vi.fn<(channel: string, listener: FocusListener) => void>()
}))

vi.mock('electron', () => ({ ipcMain: { on: electron.on } }))

import {
  CODE_EDITOR_FOCUS_CHANNEL,
  codeEditorOwnsShortcut,
  registerCodeEditorFocusMirror,
  setCodeEditorFocused
} from './code-editor-shortcut-ownership'

const cmdB = { key: 'b', code: 'KeyB', meta: true, control: false, alt: false, shift: false }
const cmdShiftB = { ...cmdB, shift: true }
const cmdP = { key: 'p', code: 'KeyP', meta: true, control: false, alt: false, shift: false }

beforeEach(() => electron.on.mockReset())

describe('codeEditorOwnsShortcut', () => {
  it('claims JetBrains navigation chords only while that renderer has a code editor focused', () => {
    expect(codeEditorOwnsShortcut(7, cmdB, 'darwin')).toBe(false)

    setCodeEditorFocused(7, true)
    expect(codeEditorOwnsShortcut(7, cmdB, 'darwin')).toBe(true)
    expect(codeEditorOwnsShortcut(7, cmdShiftB, 'darwin')).toBe(true)
    expect(codeEditorOwnsShortcut(7, cmdP, 'darwin')).toBe(false)
    expect(codeEditorOwnsShortcut(8, cmdB, 'darwin')).toBe(false)

    setCodeEditorFocused(7, false)
    expect(codeEditorOwnsShortcut(7, cmdB, 'darwin')).toBe(false)
  })

  it('follows rebinding in the user keybindings', () => {
    setCodeEditorFocused(9, true)

    expect(codeEditorOwnsShortcut(9, cmdB, 'darwin', { 'editor.goToDeclaration': ['Mod+G'] })).toBe(
      false
    )
    setCodeEditorFocused(9, false)
  })
})

describe('registerCodeEditorFocusMirror', () => {
  it('binds one renderer lifecycle cleanup across repeated focus cycles', () => {
    const listeners = new Map<string, () => void>()
    let destroyed = false
    const sender: Sender = {
      get id() {
        if (destroyed) {
          throw new Error('Object has been destroyed')
        }
        return 12
      },
      once: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener)
      }),
      removeListener: vi.fn()
    }
    registerCodeEditorFocusMirror()
    const listener = electron.on.mock.calls.find(
      ([channel]) => channel === CODE_EDITOR_FOCUS_CHANNEL
    )?.[1]
    if (!listener) {
      throw new Error('focus mirror was not registered')
    }

    listener({ sender }, true)
    listener({ sender }, false)
    listener({ sender }, true)

    expect(sender.once.mock.calls.map(([event]) => event)).toEqual([
      'destroyed',
      'render-process-gone',
      'did-navigate'
    ])
    expect(codeEditorOwnsShortcut(12, cmdB, 'darwin')).toBe(true)

    destroyed = true
    listeners.get('destroyed')?.()
    expect(codeEditorOwnsShortcut(12, cmdB, 'darwin')).toBe(false)
  })
})
