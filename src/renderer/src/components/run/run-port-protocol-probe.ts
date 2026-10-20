import type { WorkspacePort, WorkspacePortScanResult } from '../../../../shared/workspace-ports'
import { claimedPortEntries, type RunPortClaim } from './run-port-claims'
import { PROBE_HOSTS } from './run-port-debugger-probe'
import { useRunPortStore, type RunPortProtocolProbe } from './run-port-store'

async function probeProtocol(portId: string, host: string, port: number): Promise<void> {
  let protocol: 'http' | 'https' | null = null
  try {
    protocol = await window.api.debug.portProtocol({ host, port })
  } catch {
    // No answer (or no debug API, as in the web client) keeps the scanner's guess.
  }
  const { protocolsByPortId } = useRunPortStore.getState()
  if (protocolsByPortId[portId] !== 'pending') {
    return
  }
  // Why drop a null: a server still starting up gets probed again on the next scan.
  const next = Object.fromEntries(Object.entries(protocolsByPortId).filter(([id]) => id !== portId))
  useRunPortStore.setState({
    protocolsByPortId: protocol ? { ...next, [portId]: protocol } : next
  })
}

/** Whether a terminal-printed URL already names this port's scheme. */
function hasAdvertisedScheme(port: WorkspacePort): boolean {
  return port.kind === 'workspace' && Boolean(port.advertisedUrl)
}

/**
 * Probes each local loopback port a run or debug session claimed once with a TLS handshake, so a
 * dev server on an arbitrary port opens as https when it serves https.
 * Why a handshake, not a request: an http server answers it with a bare 400 and typically logs nothing.
 */
export function probeRunPortProtocols(
  claimsByOwner: Readonly<Record<string, RunPortClaim>>,
  scansByKey: Readonly<Record<string, WorkspacePortScanResult>>,
  canProbeWorktree: (worktreeId: string) => boolean
): void {
  const previous = useRunPortStore.getState().protocolsByPortId
  const listening = new Set(
    Object.values(scansByKey).flatMap((scan) => scan.ports.map((port) => port.id))
  )
  const next: Record<string, RunPortProtocolProbe> = Object.fromEntries(
    Object.entries(previous).filter(([portId]) => listening.has(portId))
  )
  let changed = Object.keys(next).length !== Object.keys(previous).length
  const toProbe: { id: string; host: string; port: number }[] = []
  for (const claim of Object.values(claimsByOwner)) {
    if (!canProbeWorktree(claim.worktreeId)) {
      continue
    }
    for (const port of claimedPortEntries(claim, scansByKey)) {
      if (next[port.id] || !PROBE_HOSTS.has(port.connectHost) || hasAdvertisedScheme(port)) {
        continue
      }
      changed = true
      next[port.id] = 'pending'
      toProbe.push({ id: port.id, host: port.connectHost, port: port.port })
    }
  }
  if (changed) {
    useRunPortStore.setState({ protocolsByPortId: next })
  }
  for (const { id, host, port } of toProbe) {
    void probeProtocol(id, host, port)
  }
}

/** The port with the scheme its probe found, when it found one. */
export function withProbedProtocol(
  port: WorkspacePort,
  protocolsByPortId: Readonly<Record<string, RunPortProtocolProbe>>
): WorkspacePort {
  const probed = protocolsByPortId[port.id]
  return probed === 'http' || probed === 'https' ? { ...port, protocol: probed } : port
}
