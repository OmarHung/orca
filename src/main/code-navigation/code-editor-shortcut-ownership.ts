import { ipcMain, type WebContents } from 'electron'
import {
  keybindingMatchesAction,
  type KeybindingInput,
  type KeybindingOverrides
} from '../../shared/keybindings'
import { CODE_NAVIGATION_KEYBINDING_ACTION_IDS } from '../../shared/keybindings/definitions-code-navigation'

export const CODE_EDITOR_FOCUS_CHANNEL = 'codeNav:setCodeEditorFocused'

// Why per webContents id: main-window routing asks about its own renderer, never a guest's.
const focusedCodeEditorOwners = new Set<number>()
const boundOwnerLifecycles = new WeakSet<WebContents>()

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
    if (focused === true && !boundOwnerLifecycles.has(sender)) {
      const id = sender.id
      boundOwnerLifecycles.add(sender)
      const cleanup = (): void => {
        sender.removeListener('destroyed', cleanup)
        sender.removeListener('render-process-gone', cleanup)
        sender.removeListener('did-navigate', cleanup)
        boundOwnerLifecycles.delete(sender)
        setCodeEditorFocused(id, false)
      }
      sender.once('destroyed', cleanup)
      sender.once('render-process-gone', cleanup)
      sender.once('did-navigate', cleanup)
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
