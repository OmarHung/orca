import { useEffect } from 'react'
import { create } from 'zustand'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { isShellProcess } from '../../../../shared/shell-process-detection'

/**
 * `connected`: ssh is in the foreground. `ended`: it was, or never came up, and something local
 * runs now. `unknown`: the foreground could not be read, so nothing can be said either way.
 */
export type SshSessionLiveness = 'starting' | 'connected' | 'ended' | 'unknown'

type SshSessionObservation = {
  liveness: SshSessionLiveness
  foreground: string | null
  hasSeenSsh: boolean
  startedAt: number
}

type SshSessionLivenessState = {
  byTab: Readonly<Record<string, SshSessionObservation>>
  recordForeground: (tabId: string, foreground: string | null, now: number) => void
  /** A new ssh was just asked for, so what earlier ssh did no longer counts. */
  markStarting: (tabId: string, now: number) => void
  prune: (openTabIds: ReadonlySet<string>) => void
}

/** How long a shell may show no ssh before the tab counts as ended; a login shell can be slow. */
export const LIVENESS_START_GRACE_MS = 20_000

const POLL_INTERVAL_MS = 2_000
/** While a tab starts, so an ssh that ends quickly is still seen and needn't wait out the grace. */
const STARTING_POLL_INTERVAL_MS = 400

export function isSshProcess(processName: string): boolean {
  const basename = processName.trim().toLowerCase().split(/[\\/]/).pop() ?? ''
  return basename.replace(/\.exe$/, '') === 'ssh'
}

/** Typing a command is only safe at a shell; any other program would read it as its own input. */
export function canReconnectInPlace(foreground: string | null): boolean {
  return foreground !== null && isShellProcess(foreground)
}

function nextObservation(
  previous: SshSessionObservation | undefined,
  foreground: string | null,
  now: number
): SshSessionObservation {
  const startedAt = previous?.startedAt ?? now
  const hasSeenSsh = previous?.hasSeenSsh === true || (foreground && isSshProcess(foreground))
  const liveness = (): SshSessionLiveness => {
    if (foreground === null) {
      return 'unknown'
    }
    if (isSshProcess(foreground)) {
      return 'connected'
    }
    // Why: Windows reports the shell even while ssh runs under it, so a shell there proves nothing.
    if (getShortcutPlatform() === 'win32') {
      return 'unknown'
    }
    if (hasSeenSsh) {
      return 'ended'
    }
    // Why: an unfamiliar program may be an ssh wrapper (autossh, kitten ssh), so don't call it over.
    if (!isShellProcess(foreground)) {
      return 'unknown'
    }
    return now - startedAt >= LIVENESS_START_GRACE_MS ? 'ended' : 'starting'
  }
  return { liveness: liveness(), foreground, hasSeenSsh: Boolean(hasSeenSsh), startedAt }
}

/** What each SSH tab's terminal was last seen running. Not saved: only a live PTY can answer. */
export const useSshSessionLivenessStore = create<SshSessionLivenessState>((set, get) => ({
  byTab: {},
  recordForeground: (tabId, foreground, now) => {
    const { byTab } = get()
    set({ byTab: { ...byTab, [tabId]: nextObservation(byTab[tabId], foreground, now) } })
  },
  markStarting: (tabId, now) => {
    const observation: SshSessionObservation = {
      liveness: 'starting',
      foreground: null,
      hasSeenSsh: false,
      startedAt: now
    }
    set({ byTab: { ...get().byTab, [tabId]: observation } })
  },
  prune: (openTabIds) => {
    const { byTab } = get()
    const open = Object.entries(byTab).filter(([tabId]) => openTabIds.has(tabId))
    if (open.length !== Object.keys(byTab).length) {
      set({ byTab: Object.fromEntries(open) })
    }
  }
}))

/** Returns the function that stops it. Each poll waits for the last, so replies can't overlap. */
function pollSshSessionForeground(tabId: string, ptyId: string): () => void {
  let isStopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const poll = async (): Promise<void> => {
    const foreground = await window.api.pty.getForegroundProcess(ptyId).catch(() => null)
    if (isStopped) {
      return
    }
    useSshSessionLivenessStore.getState().recordForeground(tabId, foreground, Date.now())
    const isStarting = useSshSessionLivenessStore.getState().byTab[tabId]?.liveness === 'starting'
    timer = setTimeout(() => void poll(), isStarting ? STARTING_POLL_INTERVAL_MS : POLL_INTERVAL_MS)
  }
  void poll()
  return () => {
    isStopped = true
    if (timer) {
      clearTimeout(timer)
    }
  }
}

/** Watches the tab on screen. A PTY that does not exist yet has nothing to report. */
export function useSshSessionLivenessPolling(
  tabId: string | null,
  ptyId: string | null,
  isEnabled: boolean
): void {
  useEffect(() => {
    if (!isEnabled || !tabId || !ptyId) {
      return
    }
    return pollSshSessionForeground(tabId, ptyId)
  }, [isEnabled, ptyId, tabId])
}
