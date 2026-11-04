import { create } from 'zustand'
import { useSshSessionLivenessStore } from './ssh-session-liveness'

export type SshSyncMode = 'keystroke' | 'line'

/** Where a pane stands in the line being typed. A command with keys missing must never run. */
export type SshSyncLine = {
  /** It has every key of the current line. Once false, only the user in that pane can restore it. */
  isFollowing: boolean
  /** It holds text on its line: part of the current line, or, once stopped, something of its own. */
  isDirty: boolean
}

export const IN_STEP_SYNC_LINE: SshSyncLine = { isFollowing: true, isDirty: false }
export const OUT_OF_STEP_SYNC_LINE: SshSyncLine = { isFollowing: false, isDirty: false }
export const HOLDING_TEXT_SYNC_LINE: SshSyncLine = { isFollowing: false, isDirty: true }

type SshSyncLines = Readonly<Record<string, SshSyncLine>>

/** Coming in now would hand this pane the tail of a line it never saw the start of. */
export function isAnotherPaneMidLine(lines: SshSyncLines, tabId: string): boolean {
  return Object.entries(lines).some(
    ([id, line]) => id !== tabId && line.isFollowing && line.isDirty
  )
}

type SshSyncState = {
  isOn: boolean
  mode: SshSyncMode
  /** Hosts the user agreed to send to. Only these ever receive anything. */
  joinedTabIds: ReadonlySet<string>
  excludedTabIds: ReadonlySet<string>
  /** Which hand-started ssh the user accepted per tab. A later one has to be accepted again. */
  acceptedManualEpochByTab: Readonly<Record<string, number>>
  lineByTab: SshSyncLines
  /** Bumped when a pane's line starts afresh, so keys queued for the old line never reach the new. */
  lineEpochByTab: Readonly<Record<string, number>>
  /** Bumped when input stops, so keystrokes still queued for a host don't go out afterwards. */
  generation: number
  start: (tabIds: readonly string[], mode: SshSyncMode) => void
  stop: () => void
  join: (tabIds: readonly string[]) => void
  setExcluded: (tabId: string, isExcluded: boolean) => void
  setMode: (mode: SshSyncMode) => void
  setLine: (tabId: string, line: SshSyncLine) => void
  stopFollowing: (tabId: string) => void
  /** Nobody is going to finish the current line, so every pane holding part of it stops. */
  stopPanesMidLine: () => void
  /** This pane's line is known to be empty, so it follows again unless the others are mid-line. */
  markLineEmpty: (tabId: string) => void
  /** Forgets panes gone from the grid: coming back takes agreeing again. */
  keepOnly: (tabIds: readonly string[]) => void
}

const NONE: ReadonlySet<string> = new Set()

function manualEpochsOf(tabIds: readonly string[]): Record<string, number> {
  const { byTab } = useSshSessionLivenessStore.getState()
  return Object.fromEntries(tabIds.map((tabId) => [tabId, byTab[tabId]?.manualSshEpoch ?? 0]))
}

function nextEpochs(
  epochs: Readonly<Record<string, number>>,
  tabId: string
): Record<string, number> {
  return { ...epochs, [tabId]: (epochs[tabId] ?? 0) + 1 }
}

function linesOf(tabIds: readonly string[], line: SshSyncLine): Record<string, SshSyncLine> {
  return Object.fromEntries(tabIds.map((tabId) => [tabId, line]))
}

function pick<T>(
  record: Readonly<Record<string, T>>,
  tabIds: readonly string[]
): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([tabId]) => tabIds.includes(tabId)))
}

/** Never saved: synced input is off whenever Orca starts. */
export const useSshSyncStore = create<SshSyncState>((set, get) => ({
  isOn: false,
  mode: 'keystroke',
  joinedTabIds: NONE,
  excludedTabIds: NONE,
  acceptedManualEpochByTab: {},
  lineByTab: {},
  lineEpochByTab: {},
  generation: 0,
  // Why in step: text already on a line can't be seen from here, so the dialog shows each line.
  start: (tabIds, mode) =>
    set({
      isOn: true,
      mode,
      joinedTabIds: new Set(tabIds),
      excludedTabIds: NONE,
      acceptedManualEpochByTab: manualEpochsOf(tabIds),
      lineByTab: linesOf(tabIds, IN_STEP_SYNC_LINE),
      lineEpochByTab: {}
    }),
  stop: () =>
    set({
      isOn: false,
      joinedTabIds: NONE,
      excludedTabIds: NONE,
      acceptedManualEpochByTab: {},
      lineByTab: {},
      lineEpochByTab: {},
      generation: get().generation + 1
    }),
  join: (tabIds) => {
    const { joinedTabIds, excludedTabIds, acceptedManualEpochByTab, lineByTab } = get()
    set({
      joinedTabIds: new Set([...joinedTabIds, ...tabIds]),
      excludedTabIds: new Set([...excludedTabIds].filter((tabId) => !tabIds.includes(tabId))),
      acceptedManualEpochByTab: { ...acceptedManualEpochByTab, ...manualEpochsOf(tabIds) },
      // Why out of step: agreeing says nothing about what its line holds, so that takes a Ctrl+C.
      lineByTab: { ...lineByTab, ...linesOf(tabIds, OUT_OF_STEP_SYNC_LINE) }
    })
  },
  setExcluded: (tabId, isExcluded) => {
    const { excludedTabIds, lineByTab, lineEpochByTab } = get()
    const rest = [...excludedTabIds].filter((id) => id !== tabId)
    const line = lineByTab[tabId] ?? OUT_OF_STEP_SYNC_LINE
    // Why: an empty line left out loses nothing by missing keys, unless it comes back mid-line.
    const canKeepFollowing =
      line.isFollowing && !line.isDirty && (isExcluded || !isAnotherPaneMidLine(lineByTab, tabId))
    set({
      excludedTabIds: new Set(isExcluded ? [...rest, tabId] : rest),
      lineByTab: {
        ...lineByTab,
        [tabId]: canKeepFollowing ? line : { isFollowing: false, isDirty: line.isDirty }
      },
      // Why: keys queued while it was in or out belong to a line it is no longer part of.
      lineEpochByTab: nextEpochs(lineEpochByTab, tabId)
    })
  },
  setMode: (mode) => {
    const { lineByTab, generation } = get()
    // Why: a half-typed line differs from whatever comes next in the other mode.
    const next = Object.entries(lineByTab).map(([tabId, line]): [string, SshSyncLine] => [
      tabId,
      line.isFollowing && !line.isDirty ? line : { isFollowing: false, isDirty: line.isDirty }
    ])
    set({ mode, generation: generation + 1, lineByTab: Object.fromEntries(next) })
  },
  setLine: (tabId, line) => set({ lineByTab: { ...get().lineByTab, [tabId]: line } }),
  stopFollowing: (tabId) => {
    const { lineByTab } = get()
    const isDirty = lineByTab[tabId]?.isDirty === true
    set({ lineByTab: { ...lineByTab, [tabId]: { isFollowing: false, isDirty } } })
  },
  stopPanesMidLine: () => {
    const next = Object.entries(get().lineByTab).map(([tabId, line]): [string, SshSyncLine] => [
      tabId,
      line.isFollowing && line.isDirty ? HOLDING_TEXT_SYNC_LINE : line
    ])
    set({ lineByTab: Object.fromEntries(next) })
  },
  markLineEmpty: (tabId) => {
    const { isOn, joinedTabIds, lineByTab, lineEpochByTab } = get()
    if (isOn && joinedTabIds.has(tabId)) {
      const line = isAnotherPaneMidLine(lineByTab, tabId)
        ? OUT_OF_STEP_SYNC_LINE
        : IN_STEP_SYNC_LINE
      set({
        lineByTab: { ...lineByTab, [tabId]: line },
        lineEpochByTab: nextEpochs(lineEpochByTab, tabId)
      })
    }
  },
  keepOnly: (tabIds) => {
    const { joinedTabIds, excludedTabIds, lineByTab } = get()
    if ([...joinedTabIds].some((id) => !tabIds.includes(id))) {
      set({
        joinedTabIds: new Set([...joinedTabIds].filter((id) => tabIds.includes(id))),
        excludedTabIds: new Set([...excludedTabIds].filter((id) => tabIds.includes(id))),
        lineByTab: pick(lineByTab, tabIds)
      })
    }
  }
}))
