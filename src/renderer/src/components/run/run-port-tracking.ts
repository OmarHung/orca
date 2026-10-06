import { useAppStore } from '@/store'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { isWindowVisible } from '@/lib/window-visibility-interval'
import {
  publishWorkspacePortScanForHost,
  scanWorkspacePortsForTarget,
  workspacePortScanKeyForTarget
} from '@/lib/workspace-port-actions'
import { runtimeTargetForExecutionHostId } from '@/runtime/runtime-client-target'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import { isLiveDebugSession, useDebugStore } from '../debug/debug-store'
import {
  claimNewPorts,
  debugPortOwnerKey,
  FAST_SCAN_WINDOW_MS,
  fastScanInterval,
  liveClaimedPorts,
  recordPortSightings,
  runPortOwnerKey,
  syncPortClaims,
  type ListenerTerminalOf,
  type RunPortOwner
} from './run-port-claims'
import { resolveListenerTerminals } from './run-port-listener-terminals'
import { probeDebugSessionPorts } from './run-port-debugger-probe'
import { isHiddenRunPort, noteRunPortScan, useRunPortStore } from './run-port-store'
import { isRunSessionActive, useRunSessionStore } from './run-session-store'
import { resolveRunTerminalBinding } from './run-terminal-binding'

const FAST_SCAN_TICK_MS = 1_000

function liveOwners(): RunPortOwner[] {
  const appState = useAppStore.getState()
  const runs = Object.values(useRunSessionStore.getState().sessionsByKey)
    .filter((session) => isRunSessionActive(session.status))
    .map((session) => ({
      key: runPortOwnerKey(session.key),
      worktreeId: session.worktreeId,
      attemptId: session.attemptId,
      ptyId: resolveRunTerminalBinding(appState, session.worktreeId, session.leafId)?.ptyId ?? null
    }))
  const debugSessions = useDebugStore
    .getState()
    .sessions.filter(isLiveDebugSession)
    .map((session) => ({
      key: debugPortOwnerKey(session.id),
      worktreeId: session.worktreeId,
      attemptId: session.id,
      ptyId: null
    }))
  return [...runs, ...debugSessions]
}

function isLocalWorktree(worktreeId: string): boolean {
  return worktreeRuntimeTarget(worktreeId)?.kind === 'local'
}

function refreshClaims(restoring = false): void {
  const { sightings, claimsByOwner } = useRunPortStore.getState()
  const scans = useAppStore.getState().workspacePortScansByKey
  const synced = syncPortClaims(claimsByOwner, liveOwners(), Date.now(), restoring)
  resolveListenerTerminals(synced, scans, isLocalWorktree, () => refreshClaims())
  const { terminalsByPortId } = useRunPortStore.getState()
  const terminalOf: ListenerTerminalOf = (port) => terminalsByPortId[port.id]
  let changed = synced !== claimsByOwner
  const next = Object.fromEntries(
    Object.entries(synced).map(([owner, claim]) => {
      const claimed = claimNewPorts(claim, sightings, scans, terminalOf)
      changed ||= claimed !== claim
      return [owner, claimed]
    })
  )
  if (changed) {
    useRunPortStore.setState({ claimsByOwner: next })
  }
  probeDebugSessionPorts(useRunPortStore.getState().claimsByOwner, scans, isLocalWorktree)
  scheduleFastScan()
}

export function worktreeRuntimeTarget(worktreeId: string): RuntimeClientTarget | null {
  return runtimeTargetForExecutionHostId(
    getExecutionHostIdForWorktree(useAppStore.getState(), worktreeId)
  )
}

let fastScanTimer: ReturnType<typeof setTimeout> | null = null
const lastFastScanAtByKey = new Map<string, number>()
const fastScansInFlight = new Set<string>()

/** Each host with a session that started recently and has no port yet, and how often to scan it. */
function hostsAwaitingPorts(
  now: number
): Map<string, { target: RuntimeClientTarget; interval: number }> {
  const scans = useAppStore.getState().workspacePortScansByKey
  const { claimsByOwner, probesByPortId } = useRunPortStore.getState()
  const isHidden = (port: WorkspacePort): boolean => isHiddenRunPort(probesByPortId, port)
  const hosts = new Map<string, { target: RuntimeClientTarget; interval: number }>()
  for (const claim of Object.values(claimsByOwner)) {
    const elapsed = claim.startedAt === null ? Infinity : now - claim.startedAt
    // Why hidden ports do not count: a debuggee's inspector binds before the program does.
    if (elapsed >= FAST_SCAN_WINDOW_MS || liveClaimedPorts([claim], scans, isHidden).length > 0) {
      continue
    }
    const target = worktreeRuntimeTarget(claim.worktreeId)
    if (target) {
      const key = workspacePortScanKeyForTarget(target)
      const interval = Math.min(hosts.get(key)?.interval ?? Infinity, fastScanInterval(elapsed))
      hosts.set(key, { target, interval })
    }
  }
  return hosts
}

async function fastScan(scanKey: string, target: RuntimeClientTarget): Promise<void> {
  fastScansInFlight.add(scanKey)
  lastFastScanAtByKey.set(scanKey, Date.now())
  try {
    const scan = await scanWorkspacePortsForTarget(target)
    if (!scan.unavailableReason) {
      const state = useAppStore.getState()
      publishWorkspacePortScanForHost({
        replaceWorkspacePortScans: state.replaceWorkspacePortScans,
        getWorkspacePortScansByKey: () => useAppStore.getState().workspacePortScansByKey,
        scanKey,
        scan
      })
    }
  } catch {
    // The background port scanner owns reporting a host whose scans fail.
  } finally {
    fastScansInFlight.delete(scanKey)
  }
}

function runFastScanTick(): void {
  fastScanTimer = null
  const now = Date.now()
  const hosts = hostsAwaitingPorts(now)
  if (hosts.size === 0) {
    return
  }
  // Why visible only: like the background scanner, no lsof or remote scans while nobody looks.
  if (isWindowVisible()) {
    for (const [scanKey, { target, interval }] of hosts) {
      const due = (lastFastScanAtByKey.get(scanKey) ?? 0) + interval
      if (now >= due && !fastScansInFlight.has(scanKey)) {
        void fastScan(scanKey, target)
      }
    }
  }
  fastScanTimer = setTimeout(runFastScanTick, FAST_SCAN_TICK_MS)
}

/** The background scan runs every 30s; a session that just started is scanned sooner. */
function scheduleFastScan(): void {
  if (fastScanTimer === null && hostsAwaitingPorts(Date.now()).size > 0) {
    fastScanTimer = setTimeout(runFastScanTick, FAST_SCAN_TICK_MS)
  }
}

function installRunPortTracking(): () => void {
  // Why: a cold start marks what already listens as predating every session; a quick reload
  // resumes from the saved sightings instead.
  const restored = useRunPortStore.getState().sightings
  const seeded = recordPortSightings(
    restored,
    useAppStore.getState().workspacePortScansByKey,
    Date.now()
  )
  if (seeded !== restored) {
    useRunPortStore.setState({ sightings: seeded })
  }
  refreshClaims(true)
  const unsubscribers = [
    useAppStore.subscribe((state, previous) => {
      if (state.workspacePortScansByKey === previous.workspacePortScansByKey) {
        // Why: a run's pane gets its PTY after the run starts.
        if (state.ptyIdsByTabId !== previous.ptyIdsByTabId) {
          refreshClaims()
        }
        return
      }
      const { sightings } = useRunPortStore.getState()
      const next = recordPortSightings(sightings, state.workspacePortScansByKey, Date.now())
      if (next !== sightings) {
        useRunPortStore.setState({ sightings: next })
      }
      noteRunPortScan()
      refreshClaims()
    }),
    useRunSessionStore.subscribe((state, previous) => {
      if (state.sessionsByKey !== previous.sessionsByKey) {
        refreshClaims()
      }
    }),
    useDebugStore.subscribe((state, previous) => {
      if (state.sessions !== previous.sessions) {
        refreshClaims()
      }
    })
  ]
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
    if (fastScanTimer !== null) {
      clearTimeout(fastScanTimer)
      fastScanTimer = null
    }
  }
}

const disposeRunPortTracking = installRunPortTracking()

if (import.meta !== undefined && import.meta.hot) {
  // Why: Vite can replace this module in place; the old copy must stop claiming and scanning.
  import.meta.hot.dispose(disposeRunPortTracking)
}
