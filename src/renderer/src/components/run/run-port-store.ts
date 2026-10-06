import { create } from 'zustand'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import type { PortSightings, RunPortClaim } from './run-port-claims'

const STORAGE_KEY = 'orca.run.portTracking.v1'
/** A reload within this long resumes where it left off; a longer gap may have hidden anything. */
const WARM_RESTORE_MS = 120_000
const HEARTBEAT_MS = 10_000

/** Whether probing found a debug session's port to be a debugger endpoint rather than the program's. */
export type RunPortProbe = 'pending' | 'debugger' | 'program'

type RunPortState = {
  sightings: PortSightings
  claimsByOwner: Readonly<Record<string, RunPortClaim>>
  /** Port id → probe verdict, for ports debug sessions claimed. */
  probesByPortId: Readonly<Record<string, RunPortProbe>>
  /** Port id → the local terminal (PTY id) its process runs under, or null outside every one. */
  terminalsByPortId: Readonly<Record<string, string | null>>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null
}

function readStoredClaim(value: unknown, warm: boolean): [string, RunPortClaim] | null {
  const record = asRecord(value)
  if (
    !record ||
    typeof record.owner !== 'string' ||
    typeof record.worktreeId !== 'string' ||
    typeof record.attemptId !== 'string' ||
    !Array.isArray(record.ports)
  ) {
    return null
  }
  const ports = record.ports.filter((port): port is number => Number.isSafeInteger(port))
  // Why null after a long gap: nothing tells this run's new listeners from anyone else's.
  const startedAt = warm && typeof record.startedAt === 'number' ? record.startedAt : null
  return [
    record.owner,
    { worktreeId: record.worktreeId, attemptId: record.attemptId, ptyId: null, startedAt, ports }
  ]
}

function readStoredSightings(value: unknown): PortSightings {
  return Object.fromEntries(
    Object.entries(asRecord(value) ?? {}).map(([scanKey, byId]) => [
      scanKey,
      Object.fromEntries(
        Object.entries(asRecord(byId) ?? {}).filter(
          (entry): entry is [string, number] => typeof entry[1] === 'number'
        )
      )
    ])
  )
}

/**
 * Restores the last state; a renderer reload (a dev-server reload, ⌘R) keeps both the runs'
 * start times and when each listener appeared, so a run still binding its port is not lost.
 */
function readStoredState(): Pick<RunPortState, 'sightings' | 'claimsByOwner'> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const stored = asRecord(raw ? JSON.parse(raw) : null)
    const savedAt = stored?.savedAt
    const age = typeof savedAt === 'number' ? Date.now() - savedAt : Infinity
    const warm = age >= 0 && age <= WARM_RESTORE_MS
    const claims = Array.isArray(stored?.claims) ? stored.claims : []
    return {
      sightings: warm ? readStoredSightings(stored?.sightings) : {},
      claimsByOwner: Object.fromEntries(
        claims.map((claim) => readStoredClaim(claim, warm)).filter((entry) => entry !== null)
      )
    }
  } catch {
    return { sightings: {}, claimsByOwner: {} }
  }
}

let lastWriteAt = 0

function writeStoredState(state: RunPortState): void {
  lastWriteAt = Date.now()
  // Why runs only: their terminals outlive a reload or restart, debug sessions do not.
  const claims = Object.entries(state.claimsByOwner)
    .filter(([owner]) => owner.startsWith('run:'))
    .map(([owner, claim]) => ({ owner, ...claim }))
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ savedAt: lastWriteAt, claims, sightings: state.sightings })
    )
  } catch {
    // Storage can be unavailable; a restored run then shows its ports only once rerun.
  }
}

// Why a standalone store: like the run session store, it keeps this fork feature out of the
// synced app store.
export const useRunPortStore = create<RunPortState>(() => ({
  ...readStoredState(),
  probesByPortId: {},
  terminalsByPortId: {}
}))

/** Records that scans are still arriving, which is what lets a quick reload trust the saved state. */
export function noteRunPortScan(): void {
  if (Date.now() - lastWriteAt >= HEARTBEAT_MS) {
    writeStoredState(useRunPortStore.getState())
  }
}

/** Hides a debugger endpoint, and a debug session's port until its probe has answered. */
export function isHiddenRunPort(
  probesByPortId: Readonly<Record<string, RunPortProbe>>,
  port: WorkspacePort
): boolean {
  const probe = probesByPortId[port.id]
  return probe === 'pending' || probe === 'debugger'
}

const unsubscribePersistence = useRunPortStore.subscribe((state, previous) => {
  if (state.claimsByOwner !== previous.claimsByOwner || state.sightings !== previous.sightings) {
    writeStoredState(state)
  }
})

if (import.meta !== undefined && import.meta.hot) {
  import.meta.hot.dispose(unsubscribePersistence)
}
