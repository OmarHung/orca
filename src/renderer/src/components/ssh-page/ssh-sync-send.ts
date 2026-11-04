import { isPtyLocked } from '@/lib/pane-manager/mobile-driver-state'
import { useAppStore } from '@/store'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import {
  readTerminalTabCursorLine,
  readTerminalTabScreen
} from '../terminal-pane/terminal-pane-manager-registry'
import { useRemoteSessionStore } from './remote-session-store'
import { isSshProcess, useSshSessionLivenessStore } from './ssh-session-liveness'
import { decideSyncTarget, looksLikeLoginPrompt, type SshSyncDecision } from './ssh-sync-decision'
import {
  HOLDING_TEXT_SYNC_LINE,
  OUT_OF_STEP_SYNC_LINE,
  useSshSyncStore,
  type SshSyncLine
} from './ssh-sync-store'

const FOREGROUND_READ_LIMIT_MS = 1_000

function sessionTabs(): readonly { id: string; ptyId: string | null }[] {
  return useAppStore.getState().tabsByWorktree[SSH_SESSIONS_WORKTREE_ID] ?? []
}

function ptyIdOf(tabId: string): string | null {
  return sessionTabs().find((tab) => tab.id === tabId)?.ptyId ?? null
}

export function tabIdOfPty(ptyId: string): string | null {
  return sessionTabs().find((tab) => tab.ptyId === ptyId)?.id ?? null
}

function lineOf(tabId: string): SshSyncLine {
  return useSshSyncStore.getState().lineByTab[tabId] ?? OUT_OF_STEP_SYNC_LINE
}

function lineEpochOf(tabId: string): number {
  return useSshSyncStore.getState().lineEpochByTab[tabId] ?? 0
}

function hasUnacceptedManualSsh(tabId: string): boolean {
  const observation = useSshSessionLivenessStore.getState().byTab[tabId]
  const accepted = useSshSyncStore.getState().acceptedManualEpochByTab[tabId] ?? 0
  return observation?.hasManualSsh === true && observation.manualSshEpoch !== accepted
}

/** Enter, Ctrl+J or Ctrl+C ends the line being typed, wherever it had got to. */
function endsLine(data: string): boolean {
  return data === '\r' || data === '\n' || data === '\u0003'
}

/** What can be known about a pane right now, given its foreground as just read. */
export function decideSyncTargetNow(
  tabId: string,
  foreground: string | null,
  isSourceFullScreen: boolean
): SshSyncDecision {
  const { joinedTabIds, excludedTabIds } = useSshSyncStore.getState()
  const screen = readTerminalTabScreen(tabId)
  return decideSyncTarget({
    isOnScreen: useRemoteSessionStore.getState().grid?.tabIds.includes(tabId) === true,
    isJoined: joinedTabIds.has(tabId),
    isExcluded: excludedTabIds.has(tabId),
    paneCount: screen?.paneCount ?? 0,
    foreground,
    hasUnacceptedManualSsh: hasUnacceptedManualSsh(tabId),
    isFullScreen: screen?.isFullScreen === true,
    isSourceFullScreen,
    cursorLine: readTerminalTabCursorLine(tabId) ?? ''
  })
}

// One chain per host, so that a slow foreground read can't let later keys overtake earlier ones.
const queues = new Map<string, Promise<unknown>>()

function enqueue<T>(tabId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(tabId) ?? Promise.resolve()
  const next = previous.then(task, task)
  const settled = next.catch(() => undefined)
  queues.set(tabId, settled)
  void settled.then(() => {
    if (queues.get(tabId) === settled) {
      queues.delete(tabId)
    }
  })
  return next
}

/** A read that never answers proves nothing, and must not hold up this host's later keys forever. */
async function readForegroundInTime(ptyId: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FOREGROUND_READ_LIMIT_MS)
  })
  const foreground = await Promise.race([
    window.api.pty.getForegroundProcess(ptyId).catch(() => null),
    timeout
  ])
  clearTimeout(timer)
  return foreground
}

// One chain per source: a key is only as good as the keys before it on the same line.
const sourceChecks = new Map<string, { lineEpoch: number; check: Promise<boolean> }>()

/** Whether a pane may speak for the others. A local shell or a host in doubt must not. */
function checkSourceKey(
  tabId: string,
  ptyId: string,
  startsLine: boolean,
  generation: number
): Promise<boolean> {
  const lineEpoch = lineEpochOf(tabId)
  const previous = sourceChecks.get(tabId)
  const earlier =
    !startsLine && previous?.lineEpoch === lineEpoch ? previous.check : Promise.resolve(true)
  const check = earlier.then(async (isEarlierTrusted) => {
    const foreground = isEarlierTrusted ? await readForegroundInTime(ptyId) : null
    const isTrusted =
      foreground !== null && isSshProcess(foreground) && !hasUnacceptedManualSsh(tabId)
    const store = useSshSyncStore.getState()
    if (!isTrusted && store.generation === generation) {
      store.stopFollowing(tabId)
    }
    return isTrusted
  })
  sourceChecks.set(tabId, { lineEpoch, check })
  return check
}

const SOURCE_NOT_SENDING: SshSyncDecision = { send: false, reason: 'sourcePaused' }
const OUT_OF_STEP: SshSyncDecision = { send: false, reason: 'outOfStep' }
const WRITE_FAILED: SshSyncDecision = { send: false, reason: 'writeFailed' }
const STOPPED: SshSyncDecision = { send: false, reason: 'notOnScreen' }

type SyncKey = {
  data: string
  isSourceFullScreen: boolean
  isSourceTrusted: Promise<boolean>
  generation: number
}

/** One key for one host. Any miss stops the host, so a damaged line never gets its Enter. */
async function sendKeyToHost(
  tabId: string,
  key: SyncKey,
  lineEpoch: number
): Promise<SshSyncDecision> {
  const store = useSshSyncStore.getState
  const ptyId = ptyIdOf(tabId)
  // Why the epoch: its line started afresh after this key was typed, so this key is the tail of a
  // line it no longer holds. Dropping it loses nothing, and sending it could run that tail.
  const isStale = (): boolean =>
    store().generation !== key.generation || lineEpochOf(tabId) !== lineEpoch
  if (!ptyId || isStale()) {
    return STOPPED
  }
  if (!lineOf(tabId).isFollowing) {
    return OUT_OF_STEP
  }
  const isTrusted = await key.isSourceTrusted
  // Why after the source check: that can take a while, and this has to be fresh when deciding.
  const foreground = await readForegroundInTime(ptyId)
  if (isStale()) {
    return STOPPED
  }
  const line = lineOf(tabId)
  if (!line.isFollowing) {
    return OUT_OF_STEP
  }
  if (!isTrusted) {
    // Why only if dirty: an empty line lost nothing, while a part-typed one has nobody to finish it.
    if (line.isDirty) {
      store().stopFollowing(tabId)
    }
    return SOURCE_NOT_SENDING
  }
  const decision = decideSyncTargetNow(tabId, foreground, key.isSourceFullScreen)
  if (!decision.send) {
    if (decision.reason !== 'excluded') {
      store().stopFollowing(tabId)
    }
    return decision
  }
  const isAccepted = await window.api.pty
    .writeAccepted(ptyId, key.data, 'driving')
    .catch(() => false)
  if (!isAccepted) {
    store().stopFollowing(tabId)
    return WRITE_FAILED
  }
  if (lineOf(tabId).isFollowing && !isStale()) {
    store().setLine(tabId, { isFollowing: true, isDirty: !endsLine(key.data) })
  }
  return decision
}

/** A key that stays in its own pane. Only the user ending the line there shows it is empty again. */
function noteKeyStayingHere(tabId: string, data: string, isFullScreen: boolean): void {
  const store = useSshSyncStore.getState()
  // Why not Enter in a full-screen program: it doesn't end anything there, while Ctrl+C mostly does.
  if (data === '\u0003' || (!isFullScreen && endsLine(data))) {
    store.markLineEmpty(tabId)
  } else {
    store.setLine(tabId, HOLDING_TEXT_SYNC_LINE)
  }
}

/** Sends what was just typed in one pane to the others. The source's own terminal already has it. */
export function mirrorToOtherPanes(sourceTabId: string, data: string): void {
  const store = useSshSyncStore.getState()
  const grid = useRemoteSessionStore.getState().grid
  if (!store.isOn || !grid?.tabIds.includes(sourceTabId) || !store.joinedTabIds.has(sourceTabId)) {
    return
  }
  const sourcePtyId = ptyIdOf(sourceTabId)
  const source = readTerminalTabScreen(sourceTabId)
  // Why stop it: what a split pane or a phone typed there can't be seen from here.
  if (!sourcePtyId || source?.paneCount !== 1 || isPtyLocked(sourcePtyId)) {
    store.setLine(sourceTabId, HOLDING_TEXT_SYNC_LINE)
    return
  }
  const line = lineOf(sourceTabId)
  const isAtPrompt = looksLikeLoginPrompt(readTerminalTabCursorLine(sourceTabId) ?? '')
  // Why: this key stays here, so nobody will finish the part of a line the others got. Even if it
  // only looks like a prompt, this pane went on alone, and those panes hold a cut-off command.
  if (isAtPrompt && line.isFollowing && line.isDirty) {
    store.stopPanesMidLine()
  }
  const isSpeaking =
    store.mode === 'keystroke' &&
    !store.excludedTabIds.has(sourceTabId) &&
    line.isFollowing &&
    !isAtPrompt &&
    // Why: it is behind on the others' keys, so what it types here would land out of order.
    !queues.has(sourceTabId)
  if (!isSpeaking) {
    noteKeyStayingHere(sourceTabId, data, source.isFullScreen)
    return
  }
  store.setLine(sourceTabId, { isFollowing: true, isDirty: !endsLine(data) })
  const key: SyncKey = {
    data,
    isSourceFullScreen: source.isFullScreen,
    isSourceTrusted: checkSourceKey(sourceTabId, sourcePtyId, !line.isDirty, store.generation),
    generation: store.generation
  }
  for (const tabId of grid.tabIds.filter((id) => id !== sourceTabId)) {
    const lineEpoch = lineEpochOf(tabId)
    void enqueue(tabId, () => sendKeyToHost(tabId, key, lineEpoch))
  }
}

/**
 * This pane got input the others didn't. If that finished a line its line is empty now, and if not
 * it holds something the others don't, so it stops until the user clears it.
 */
export function markPaneDiverged(tabId: string, data: string): void {
  const store = useSshSyncStore.getState()
  if (!store.isOn || !store.joinedTabIds.has(tabId)) {
    return
  }
  if (/[\r\n]$/.test(data) && readTerminalTabScreen(tabId)?.isFullScreen !== true) {
    store.markLineEmpty(tabId)
  } else {
    store.setLine(tabId, HOLDING_TEXT_SYNC_LINE)
  }
}

export type SshSyncLineResult = { tabId: string; decision: SshSyncDecision }

/** One whole line for one host, which always goes to a shell: never into a full-screen program. */
async function sendLineToHost(
  tabId: string,
  text: string,
  generation: number
): Promise<SshSyncDecision> {
  const store = useSshSyncStore.getState
  const ptyId = ptyIdOf(tabId)
  if (!ptyId || store().generation !== generation) {
    return STOPPED
  }
  const foreground = await readForegroundInTime(ptyId)
  if (store().generation !== generation) {
    return STOPPED
  }
  const decision = decideSyncTargetNow(tabId, foreground, false)
  if (!decision.send) {
    return decision
  }
  const line = lineOf(tabId)
  if (!line.isFollowing || line.isDirty) {
    return OUT_OF_STEP
  }
  const isAccepted = await window.api.pty.writeAccepted(ptyId, text, 'driving').catch(() => false)
  return isAccepted ? decision : WRITE_FAILED
}

/** Sends a whole line to every pane, the one in use included, since none of them typed it. */
export function sendLineToPanes(line: string): Promise<SshSyncLineResult[]> {
  const { isOn, generation } = useSshSyncStore.getState()
  const grid = useRemoteSessionStore.getState().grid
  if (!isOn || !grid) {
    return Promise.resolve([])
  }
  return Promise.all(
    grid.tabIds.map(async (tabId) => ({
      tabId,
      decision: await enqueue(tabId, () => sendLineToHost(tabId, `${line}\r`, generation))
    }))
  )
}
