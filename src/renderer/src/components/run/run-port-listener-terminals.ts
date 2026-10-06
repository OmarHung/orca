import type { WorkspacePortScanResult } from '../../../../shared/workspace-ports'
import type { RunPortClaim } from './run-port-claims'
import { useRunPortStore } from './run-port-store'

const pendingPortIds = new Set<string>()

async function lookUp(portIdByPid: ReadonlyMap<number, string[]>, onResolved: () => void) {
  let terminals: Record<number, string | null> = {}
  try {
    terminals = await window.api.debug.listenerTerminals([...portIdByPid.keys()])
  } catch {
    // No answer (or no debug API, as in the web client) leaves these ports to the time rule.
  }
  const resolved: Record<string, string | null> = {}
  for (const [pid, portIds] of portIdByPid) {
    for (const portId of portIds) {
      pendingPortIds.delete(portId)
      resolved[portId] = terminals[pid] ?? null
    }
  }
  useRunPortStore.setState({
    terminalsByPortId: { ...useRunPortStore.getState().terminalsByPortId, ...resolved }
  })
  onResolved()
}

/**
 * Looks up which local terminal each listener in a workspace with a live session runs under, once
 * per listener, and forgets listeners that went away. Listeners on other hosts, or without a pid,
 * are outside every local terminal.
 */
export function resolveListenerTerminals(
  claimsByOwner: Readonly<Record<string, RunPortClaim>>,
  scansByKey: Readonly<Record<string, WorkspacePortScanResult>>,
  isLocalWorktree: (worktreeId: string) => boolean,
  onResolved: () => void
): void {
  const previous = useRunPortStore.getState().terminalsByPortId
  const worktreeIds = new Set(Object.values(claimsByOwner).map((claim) => claim.worktreeId))
  const listening = Object.values(scansByKey).flatMap((scan) => scan.ports)
  const listeningIds = new Set(listening.map((port) => port.id))
  const next: Record<string, string | null> = Object.fromEntries(
    Object.entries(previous).filter(([portId]) => listeningIds.has(portId))
  )
  let changed = Object.keys(next).length !== Object.keys(previous).length
  const portIdByPid = new Map<number, string[]>()
  for (const port of listening) {
    if (
      port.kind !== 'workspace' ||
      !worktreeIds.has(port.owner.worktreeId) ||
      port.id in next ||
      pendingPortIds.has(port.id)
    ) {
      continue
    }
    if (port.pid === undefined || !isLocalWorktree(port.owner.worktreeId)) {
      next[port.id] = null
      changed = true
      continue
    }
    pendingPortIds.add(port.id)
    portIdByPid.set(port.pid, [...(portIdByPid.get(port.pid) ?? []), port.id])
  }
  if (changed) {
    useRunPortStore.setState({ terminalsByPortId: next })
  }
  if (portIdByPid.size > 0) {
    void lookUp(portIdByPid, onResolved)
  }
}
