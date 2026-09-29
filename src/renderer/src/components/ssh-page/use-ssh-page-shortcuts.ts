import { useEffect } from 'react'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { useAppStore } from '@/store'
import { keybindingMatchesAction, type KeybindingActionId } from '../../../../shared/keybindings'
import { getKeybindingContext } from '../terminal-workspace-model'

type SshPageShortcutHandlers = {
  isVisible: boolean
  onNewSession: () => void
  onCloseActiveSession: () => void
}

/** New-tab and close-tab shortcuts on the SSH page; the project workspace skips them there. */
export function useSshPageShortcuts({
  isVisible,
  onNewSession,
  onCloseActiveSession
}: SshPageShortcutHandlers): void {
  useEffect(() => {
    if (!isVisible) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
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
  }, [isVisible, onNewSession, onCloseActiveSession])
}
