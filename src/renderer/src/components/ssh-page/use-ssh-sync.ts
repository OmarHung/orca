import { useEffect, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import {
  observeTerminalDirectInput,
  readTerminalTabScreen
} from '../terminal-pane/terminal-pane-manager-registry'
import { isXtermWheelCursorKey } from '../terminal-pane/input/pointer/terminal-pointer-input-sequences'
import { subscribeToTerminalInputData } from '../terminal-pane/input/terminal-user-input-signal'
import { useRemoteSessionStore } from './remote-session-store'
import { useSshSessionLivenessStore } from './ssh-session-liveness'
import { classifySyncInput, decideSyncPaneStatus, type SshSyncDecision } from './ssh-sync-decision'
import {
  decideSyncTargetNow,
  markPaneDiverged,
  mirrorToOtherPanes,
  tabIdOfPty
} from './ssh-sync-send'
import { isAnotherPaneMidLine, useSshSyncStore } from './ssh-sync-store'
import { watchTabTerminals } from './ssh-tab-terminal-watch'

/** The wheel turns into arrow keys in a full-screen program, and those are not typing. */
const WHEEL_ARROW_WINDOW_MS = 150
const STATUS_REFRESH_MS = 1_000

/** Synced input needs proof that ssh is in front, and Windows only ever reports the shell. */
export function isSshSyncSupported(): boolean {
  return getShortcutPlatform() !== 'win32'
}

/** A paste that stayed in one pane leaves it out of step, which it has to be told. */
function notePasteStayedHere(tabId: string, data: string): void {
  markPaneDiverged(tabId, data)
  toast.info(
    translate(
      'sshPage.sync.multilinePaste',
      'Pasted lines only went to this pane, since each line would press Enter on every host. Use a saved command instead.'
    )
  )
}

/** Listens to one pane without touching its own input. */
function attachMirror(tabId: string, terminal: Terminal): () => void {
  let lastWheelAt = Number.NEGATIVE_INFINITY
  const markWheel = (): void => {
    lastWheelAt = performance.now()
  }
  const element = terminal.element
  element?.addEventListener('wheel', markWheel, { capture: true, passive: true })
  const subscription = subscribeToTerminalInputData(terminal, (data, wasUserInput) => {
    const isWheelArrow =
      isXtermWheelCursorKey(data) &&
      terminal.buffer.active.type === 'alternate' &&
      performance.now() - lastWheelAt < WHEEL_ARROW_WINDOW_MS
    if (isWheelArrow) {
      return
    }
    const input = classifySyncInput(data, wasUserInput)
    if (input.kind === 'mirror') {
      mirrorToOtherPanes(tabId, input.data)
    } else if (input.kind === 'pasteStaysHere') {
      notePasteStayedHere(tabId, data)
    }
  })
  return () => {
    subscription.dispose()
    element?.removeEventListener('wheel', markWheel, { capture: true })
  }
}

/** Mirrors what is typed in any pane of the grid while sync is on. */
function useMirrorTypedInput(isActive: boolean, tabIds: readonly string[]): void {
  const tabIdsKey = tabIds.join('\n')
  useEffect(() => {
    if (!isActive) {
      return
    }
    const stopWatching = watchTabTerminals(
      tabIdsKey.split('\n'),
      attachMirror,
      // Why: while split, what it typed couldn't be seen, so its line can't be vouched for.
      (tabId) => markPaneDiverged(tabId, '')
    )
    const stopObserving = observeTerminalDirectInput({
      onShortcutInput: (ptyId, data) => {
        const tabId = tabIdOfPty(ptyId)
        if (tabId) {
          mirrorToOtherPanes(tabId, data)
        }
      },
      onOtherInput: (ptyId, data) => {
        const tabId = tabIdOfPty(ptyId)
        if (tabId) {
          markPaneDiverged(tabId, data)
        }
      }
    })
    return () => {
      stopWatching()
      stopObserving()
    }
  }, [isActive, tabIdsKey])
}

/** Keeps synced input tied to what is on screen. It never outlives the page or the grid. */
export function useSshSync(isVisible: boolean): void {
  const isOn = useSshSyncStore((s) => s.isOn)
  const joinedTabIds = useSshSyncStore((s) => s.joinedTabIds)
  const grid = useRemoteSessionStore((s) => s.grid)
  const gridTabIds = grid?.tabIds
  const gridKey = gridTabIds?.join('\n') ?? ''

  useEffect(() => {
    if (useSshSyncStore.getState().isOn && (!isVisible || !gridKey)) {
      useSshSyncStore.getState().stop()
    }
  }, [gridKey, isVisible])

  useEffect(() => {
    const store = useSshSyncStore.getState()
    if (!store.isOn || !gridKey) {
      return
    }
    const tabIds = gridKey.split('\n')
    store.keepOnly(tabIds)
    if (tabIds.filter((tabId) => useSshSyncStore.getState().joinedTabIds.has(tabId)).length < 2) {
      store.stop()
      toast.info(
        translate('sshPage.sync.stoppedTooFew', 'Synced input ended: fewer than two hosts left.')
      )
    }
  }, [gridKey, joinedTabIds])

  // Why in both modes: typing in a pane during the line mode still has to be noted for it.
  useMirrorTypedInput(isOn, gridTabIds ?? [])
}

/** The panes input would reach now, for what the page shows. Each key still decides for itself. */
export function useSshSyncReceivingTabIds(tabIds: readonly string[]): readonly string[] {
  // Why strings: these change often while typing, and the page only cares when the list does.
  const followingKey = useSshSyncStore((s) =>
    s.isOn
      ? tabIds
          .filter(
            (id) =>
              s.joinedTabIds.has(id) && !s.excludedTabIds.has(id) && s.lineByTab[id]?.isFollowing
          )
          .join('\n')
      : ''
  )
  const notEndedKey = useSshSessionLivenessStore((s) =>
    tabIds.filter((id) => s.byTab[id]?.liveness !== 'ended').join('\n')
  )
  const notEnded = notEndedKey.split('\n')
  return followingKey === '' ? [] : followingKey.split('\n').filter((id) => notEnded.includes(id))
}

export type SshSyncPaneStatus = { isOn: false } | { isOn: true; decision: SshSyncDecision }

/**
 * What a pane's title should say, refreshed on a timer. Only for showing: each keystroke decides
 * again from a fresh read, so this being a moment behind never sends anything.
 */
export function useSshSyncPaneStatus(tabId: string, sourceTabId: string): SshSyncPaneStatus {
  const isOn = useSshSyncStore((s) => s.isOn)
  const mode = useSshSyncStore((s) => s.mode)
  const lines = useSshSyncStore((s) => s.lineByTab)
  useSshSyncStore((s) => s.joinedTabIds)
  useSshSyncStore((s) => s.excludedTabIds)
  useSshSyncStore((s) => s.acceptedManualEpochByTab)
  const foreground = useSshSessionLivenessStore((s) => s.byTab[tabId]?.foreground ?? null)
  const sourceForeground = useSshSessionLivenessStore(
    (s) => s.byTab[sourceTabId]?.foreground ?? null
  )
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isOn) {
      return
    }
    const timer = setInterval(() => setTick((tick) => tick + 1), STATUS_REFRESH_MS)
    return () => clearInterval(timer)
  }, [isOn])
  if (!isOn) {
    return { isOn: false }
  }
  const isLineMode = mode === 'line'
  const isSourceFullScreen =
    !isLineMode && readTerminalTabScreen(sourceTabId)?.isFullScreen === true
  // Why: in the keystroke mode, a pane in use that isn't sending leaves the others with nothing.
  const isSourceSending =
    isLineMode ||
    tabId === sourceTabId ||
    (lines[sourceTabId]?.isFollowing === true &&
      decideSyncTargetNow(sourceTabId, sourceForeground, isSourceFullScreen).send)
  return {
    isOn: true,
    decision: decideSyncPaneStatus({
      decision: decideSyncTargetNow(tabId, foreground, isSourceFullScreen),
      isFollowing: lines[tabId]?.isFollowing === true,
      isHoldingText: lines[tabId]?.isDirty === true,
      isAnotherPaneMidLine: isAnotherPaneMidLine(lines, tabId),
      isSourceSending
    })
  }
}
