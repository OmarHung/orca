import { editorShortcutMatches } from '@/components/editor/editor-shortcuts'
import type { KeybindingActionId } from '../../../../shared/keybindings'
import { CODE_NAVIGATION_KEYBINDING_ACTION_IDS } from '../../../../shared/keybindings/definitions-code-navigation'

type FocusableEditor = { hasTextFocus: () => boolean }

let claimingEditor: FocusableEditor | null = null

/** The editor tab whose JetBrains-style chords win over app shortcuts; null when none has focus. */
export function setClaimingCodeEditor(editor: FocusableEditor | null): void {
  claimingEditor = editor
}

/**
 * The navigation action this keydown triggers in the focused editor tab, if any. The app-wide
 * shortcut handler checks it first: Monaco's EditContext input is a plain div, not an editable
 * target, so Cmd/Ctrl+B would otherwise also toggle the sidebar.
 */
export function codeEditorShortcutAction(event: KeyboardEvent): KeybindingActionId | null {
  if (!claimingEditor?.hasTextFocus() || event.isComposing) {
    return null
  }
  return (
    CODE_NAVIGATION_KEYBINDING_ACTION_IDS.find((id) => editorShortcutMatches(id, event)) ?? null
  )
}
