import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { on: vi.fn() } }))

import { codeEditorOwnsShortcut, setCodeEditorFocused } from './code-editor-shortcut-ownership'

const cmdB = { key: 'b', code: 'KeyB', meta: true, control: false, alt: false, shift: false }
const cmdShiftB = { ...cmdB, shift: true }
const cmdP = { key: 'p', code: 'KeyP', meta: true, control: false, alt: false, shift: false }

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
