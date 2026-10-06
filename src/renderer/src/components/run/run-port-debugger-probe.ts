import type { WorkspacePortScanResult } from '../../../../shared/workspace-ports'
import { claimedPortEntries, isDebugPortOwnerKey, type RunPortClaim } from './run-port-claims'
import { useRunPortStore, type RunPortProbe } from './run-port-store'

const PROBE_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost'])

async function probePort(portId: string, host: string, port: number): Promise<void> {
  let isDebugger = false
  try {
    isDebugger = await window.api.debug.isDebuggerPort({ host, port })
  } catch {
    // No answer (or no debug API, as in the web client) leaves the port shown as the program's.
  }
  const { probesByPortId } = useRunPortStore.getState()
  if (probesByPortId[portId] === 'pending') {
    useRunPortStore.setState({
      probesByPortId: { ...probesByPortId, [portId]: isDebugger ? 'debugger' : 'program' }
    })
  }
}

/**
 * Probes each port a debug session claimed once, and forgets listeners that went away.
 * Why debug sessions only: js-debug opens an inspector inside every Node debuggee, while probing a
 * plain run's dev server would only leave a stray request in its log.
 */
export function probeDebugSessionPorts(
  claimsByOwner: Readonly<Record<string, RunPortClaim>>,
  scansByKey: Readonly<Record<string, WorkspacePortScanResult>>,
  canProbeWorktree: (worktreeId: string) => boolean
): void {
  const previous = useRunPortStore.getState().probesByPortId
  const listening = new Set(
    Object.values(scansByKey).flatMap((scan) => scan.ports.map((port) => port.id))
  )
  const next: Record<string, RunPortProbe> = Object.fromEntries(
    Object.entries(previous).filter(([portId]) => listening.has(portId))
  )
  let changed = Object.keys(next).length !== Object.keys(previous).length
  const toProbe: { id: string; host: string; port: number }[] = []
  for (const [owner, claim] of Object.entries(claimsByOwner)) {
    if (!isDebugPortOwnerKey(owner)) {
      continue
    }
    const probeable = canProbeWorktree(claim.worktreeId)
    for (const port of claimedPortEntries(claim, scansByKey)) {
      if (next[port.id]) {
        continue
      }
      changed = true
      // Why only local loopback: that is where a debug adapter's debuggee runs.
      if (probeable && PROBE_HOSTS.has(port.connectHost)) {
        next[port.id] = 'pending'
        toProbe.push({ id: port.id, host: port.connectHost, port: port.port })
      } else {
        next[port.id] = 'program'
      }
    }
  }
  if (changed) {
    useRunPortStore.setState({ probesByPortId: next })
  }
  for (const { id, host, port } of toProbe) {
    void probePort(id, host, port)
  }
}
