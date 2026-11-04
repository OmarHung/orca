import { useEffect } from 'react'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { useAppStore } from '@/store'
import { keybindingMatchesAction, type KeybindingActionId } from '../../../../shared/keybindings'
import { getKeybindingContext } from '../terminal-workspace-model'
import type { RemoteLayout } from './remote-session-store'

const LAYOUT_BY_KEY_CODE: ReadonlyMap<string, RemoteLayout> = new Map([
  ['Digit1', 'terminal'],
  ['Digit2', 'split'],
  ['Digit3', 'files']
])

type SshPageShortcutHandlers = {
  isVisible: boolean
  onNewSession: () => void
  onCloseActiveSession: () => void
  onSetLayout: (layout: RemoteLayout) => void
}

type LayoutKeyEvent = Pick<
  KeyboardEvent,
  'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code' | 'getModifierState'
>

/** ⌘⌥1/2/3 on macOS, Ctrl+Alt+1/2/3 elsewhere. By key code: Option turns the digits into symbols. */
export function layoutFromKeyEvent(
  event: LayoutKeyEvent,
  platform: ReturnType<typeof getShortcutPlatform>
): RemoteLayout | null {
  const isPrimary =
    platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  // Why AltGraph: it reports as Ctrl+Alt on Windows, and types characters on many keyboards.
  if (!isPrimary || !event.altKey || event.shiftKey || event.getModifierState('AltGraph')) {
    return null
  }
  return LAYOUT_BY_KEY_CODE.get(event.code) ?? null
}

/** Tab and layout shortcuts on the SSH page; the project workspace skips them there. */
export function useSshPageShortcuts({
  isVisible,
  onNewSession,
  onCloseActiveSession,
  onSetLayout
}: SshPageShortcutHandlers): void {
  useEffect(() => {
    if (!isVisible) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return
      }
      const layout = layoutFromKeyEvent(event, getShortcutPlatform())
      if (layout) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        onSetLayout(layout)
        return
      }
      const state = useAppStore.getState()
      const matches = (actionId: KeybindingActionId): boolean =>
        keybindingMatchesAction(actionId, event, getShortcutPlatform(), state.keybindings, {
          context: getKeybindingContext(event.target),
          terminalShortcutPolicy: state.settings?.terminalShortcutPolicy
        })
      const action = matches('tab.newTerminal')
        ? onNewSession
        : matches('tab.close')
          ? onCloseActiveSession
          : null
      if (!action) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      action()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [isVisible, onNewSession, onCloseActiveSession, onSetLayout])
}
