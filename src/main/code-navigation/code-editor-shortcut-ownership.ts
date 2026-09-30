import { ipcMain } from 'electron'
import {
  keybindingMatchesAction,
  type KeybindingInput,
  type KeybindingOverrides
} from '../../shared/keybindings'
import { CODE_NAVIGATION_KEYBINDING_ACTION_IDS } from '../../shared/keybindings/definitions-code-navigation'

export const CODE_EDITOR_FOCUS_CHANNEL = 'codeNav:setCodeEditorFocused'

// Why per webContents id: main-window routing asks about its own renderer, never a guest's.
const focusedCodeEditorOwners = new Set<number>()

export function setCodeEditorFocused(webContentsId: number, focused: boolean): void {
  if (focused) {
    focusedCodeEditorOwners.add(webContentsId)
  } else {
    focusedCodeEditorOwners.delete(webContentsId)
  }
}

/** Mirrors code-editor focus from renderers; strict boolean so malformed IPC can't claim chords. */
export function registerCodeEditorFocusMirror(): void {
  ipcMain.on(CODE_EDITOR_FOCUS_CHANNEL, (event, focused: unknown) => {
    const { sender } = event
    setCodeEditorFocused(sender.id, focused === true)
    if (focused === true) {
      sender.once('destroyed', () => setCodeEditorFocused(sender.id, false))
    }
  })
}

/**
 * Whether a focused code editor claims this chord (e.g. JetBrains Cmd+B), so window-level
 * interception must let it reach the renderer instead of toggling the sidebar.
 */
export function codeEditorOwnsShortcut(
  webContentsId: number,
  input: KeybindingInput,
  platform: NodeJS.Platform,
  keybindings?: KeybindingOverrides
): boolean {
  return (
    focusedCodeEditorOwners.has(webContentsId) &&
    CODE_NAVIGATION_KEYBINDING_ACTION_IDS.some((actionId) =>
      keybindingMatchesAction(actionId, input, platform, keybindings)
    )
  )
}
