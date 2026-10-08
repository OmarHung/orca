import type { WorkspacePort, WorkspacePortScanResult } from '../../../../shared/workspace-ports'

/** When a listener was first seen, per host scan key and port id. */
export type PortSightings = Readonly<Record<string, Readonly<Record<string, number>>>>

/** Sighting time of a listener already present in a host's first scan, so its age is unknown. */
export const PREEXISTING_PORT_SIGHTING = 0

/** One run or debug session and the ports it opened during its current attempt. */
export type RunPortClaim = {
  worktreeId: string
  attemptId: string
  /** The run's terminal; null for a debug session or a run whose pane is not bound yet. */
  ptyId: string | null
  /** Null when restored after a long gap: only its own terminal's ports can then be told apart. */
  startedAt: number | null
  ports: readonly number[]
}

/** Live run or debug sessions, keyed by owner key, as the claim bookkeeping sees them. */
export type RunPortOwner = {
  key: string
  worktreeId: string
  attemptId: string
  ptyId: string | null
}

/**
 * The local terminal a listener runs under: a PTY id, null outside every terminal (a container
 * forwarder, a debuggee, another host), or undefined while that is still being looked up.
 */
export type ListenerTerminalOf = (port: WorkspacePort) => string | null | undefined

export function runPortOwnerKey(runSessionKey: string): string {
  return `run:${runSessionKey}`
}

export function debugPortOwnerKey(debugSessionId: string): string {
  return `debug:${debugSessionId}`
}

export function isDebugPortOwnerKey(ownerKey: string): boolean {
  return ownerKey.startsWith('debug:')
}

function sightingsForScan(
  previous: Readonly<Record<string, number>> | undefined,
  scan: WorkspacePortScanResult,
  now: number
): Readonly<Record<string, number>> {
  const seenAt = previous ? now : PREEXISTING_PORT_SIGHTING
  const next = Object.fromEntries(
    scan.ports.map((port) => [port.id, previous?.[port.id] ?? seenAt])
  )
  const unchanged =
    previous !== undefined &&
    Object.keys(previous).length === scan.ports.length &&
    scan.ports.every((port) => previous[port.id] !== undefined)
  return unchanged ? previous : next
}

/**
 * Records when each listener first appeared. Why ids: they carry the pid, so a rerun that binds
 * the same port again is a new listener. A failed scan is skipped, or every port would look new,
 * and a host not scanned yet keeps what was restored for it.
 */
export function recordPortSightings(
  previous: PortSightings,
  scansByKey: Readonly<Record<string, WorkspacePortScanResult>>,
  now: number
): PortSightings {
  let changed = false
  const next: Record<string, Readonly<Record<string, number>>> = { ...previous }
  for (const [scanKey, scan] of Object.entries(scansByKey)) {
    const before = previous[scanKey]
    const after = scan.unavailableReason ? before : sightingsForScan(before, scan, now)
    if (after && after !== before) {
      next[scanKey] = after
      changed = true
    }
  }
  return changed ? next : previous
}

function workspacePortsOf(
  scansByKey: Readonly<Record<string, WorkspacePortScanResult>>,
  worktreeId: string
): { scanKey: string; port: WorkspacePort }[] {
  return Object.entries(scansByKey).flatMap(([scanKey, scan]) =>
    scan.ports
      .filter((port) => port.kind === 'workspace' && port.owner.worktreeId === worktreeId)
      .map((port) => ({ scanKey, port }))
  )
}

function belongsToClaim(
  claim: RunPortClaim,
  terminal: string | null | undefined,
  sighting: number | undefined
): boolean {
  if (terminal === undefined) {
    return false
  }
  if (terminal !== null) {
    return terminal === claim.ptyId
  }
  return claim.startedAt !== null && (sighting ?? -1) >= claim.startedAt
}

/**
 * Brings a claim up to date with the workspace's listeners. A listener under a terminal belongs to
 * that terminal's run alone, which keeps runs sharing a workspace apart. One outside every terminal
 * (a container forwarder, a debuggee) can only be told apart by time: it is claimed when it
 * appeared after the attempt started. A claimed port now held under another terminal is released.
 */
export function claimNewPorts(
  claim: RunPortClaim,
  sightings: PortSightings,
  scansByKey: Readonly<Record<string, WorkspacePortScanResult>>,
  terminalOf: ListenerTerminalOf = () => null
): RunPortClaim {
  const listeners = workspacePortsOf(scansByKey, claim.worktreeId).map(({ scanKey, port }) => ({
    port,
    terminal: terminalOf(port),
    sighting: sightings[scanKey]?.[port.id]
  }))
  const heldElsewhere = (portNumber: number): boolean =>
    listeners.some(
      ({ port, terminal }) =>
        port.port === portNumber && typeof terminal === 'string' && terminal !== claim.ptyId
    )
  const kept = claim.ports.filter((portNumber) => !heldElsewhere(portNumber))
  const added = listeners
    .filter(({ terminal, sighting }) => belongsToClaim(claim, terminal, sighting))
    .map(({ port }) => port.port)
    .filter((port, index, all) => !kept.includes(port) && all.indexOf(port) === index)
  return added.length === 0 && kept.length === claim.ports.length
    ? claim
    : { ...claim, ports: [...kept, ...added] }
}

function preferredPort(a: WorkspacePort, b: WorkspacePort): WorkspacePort {
  const rank = (port: WorkspacePort): number =>
    (port.kind === 'workspace' && port.advertisedUrl ? 0 : 2) +
    (port.connectHost === 'localhost' ? 0 : 1)
  return rank(b) < rank(a) ? b : a
}

/** Every listener behind a claim's ports, with IPv4 and IPv6 binds as separate entries. */
export function claimedPortEntries(
  claim: RunPortClaim,
  scansByKey: Readonly<Record<string, WorkspacePortScanResult>>
): WorkspacePort[] {
  return workspacePortsOf(scansByKey, claim.worktreeId)
    .map(({ port }) => port)
    .filter((port) => claim.ports.includes(port.port))
}

const LOOPBACK_PAIR = ['127.0.0.1', '::1']

function rowForListeners(listeners: readonly WorkspacePort[]): WorkspacePort {
  const row = listeners.reduce(preferredPort)
  const hosts = new Set(listeners.map((port) => port.connectHost))
  // Why: binding `localhost` (Kestrel, Node) opens one socket per loopback family; naming the
  // row after either half reads as a different host than the one the server was given.
  return LOOPBACK_PAIR.includes(row.connectHost) && LOOPBACK_PAIR.every((host) => hosts.has(host))
    ? { ...row, connectHost: 'localhost' }
    : row
}

/** The claimed ports still listening, one row per port number even when bound on IPv4 and IPv6. */
export function liveClaimedPorts(
  claims: readonly RunPortClaim[],
  scansByKey: Readonly<Record<string, WorkspacePortScanResult>>,
  isHidden: (port: WorkspacePort) => boolean = () => false
): WorkspacePort[] {
  const byPort = new Map<number, WorkspacePort[]>()
  for (const claim of claims) {
    for (const port of claimedPortEntries(claim, scansByKey)) {
      if (!isHidden(port)) {
        byPort.set(port.port, [...(byPort.get(port.port) ?? []), port])
      }
    }
  }
  return [...byPort.values()].map(rowForListeners).sort((a, b) => a.port - b.port)
}

/**
 * Keeps a claim per live owner: a new attempt starts empty, an ended one is dropped.
 * `restoring` marks owners that were already running before Orca started watching.
 */
export function syncPortClaims(
  previous: Readonly<Record<string, RunPortClaim>>,
  owners: readonly RunPortOwner[],
  now: number,
  restoring: boolean
): Readonly<Record<string, RunPortClaim>> {
  let changed = Object.keys(previous).length !== owners.length
  const next: Record<string, RunPortClaim> = {}
  for (const owner of owners) {
    const kept = previous[owner.key]
    if (kept?.attemptId === owner.attemptId) {
      // Why: a run's pane binds its PTY after the run starts, and a rebind replaces it.
      next[owner.key] = kept.ptyId === owner.ptyId ? kept : { ...kept, ptyId: owner.ptyId }
      changed ||= next[owner.key] !== kept
      continue
    }
    changed = true
    next[owner.key] = {
      worktreeId: owner.worktreeId,
      attemptId: owner.attemptId,
      ptyId: owner.ptyId,
      startedAt: restoring ? null : now,
      ports: []
    }
  }
  return changed ? next : previous
}

const FAST_SCAN_MIN_INTERVAL_MS = 1_000
const FAST_SCAN_MAX_INTERVAL_MS = 10_000
/** How long after a start a session without a port keeps its host on the fast scan. */
export const FAST_SCAN_WINDOW_MS = 120_000

/** Scans sooner right after a start, when a dev server usually binds, then backs off. */
export function fastScanInterval(elapsedMs: number): number {
  return Math.min(
    FAST_SCAN_MAX_INTERVAL_MS,
    Math.max(FAST_SCAN_MIN_INTERVAL_MS, Math.round(elapsedMs / 4))
  )
}
