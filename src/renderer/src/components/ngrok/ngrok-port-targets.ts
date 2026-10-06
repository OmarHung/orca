import type {
  NgrokEndpoint,
  NgrokShareRequest,
  NgrokSnapshot
} from '../../../../shared/ngrok/ngrok-types'
import type { PortForwardEntry } from '../../../../shared/ssh-types'
import type { WorkspacePort, WorkspacePortScanResult } from '../../../../shared/workspace-ports'

const LOOPBACK_HOSTS: Record<string, NgrokShareRequest['host']> = {
  localhost: 'localhost',
  '127.0.0.1': '127.0.0.1',
  '::1': '::1',
  // Why: a wildcard bind answers on loopback too.
  '0.0.0.0': 'localhost',
  '::': 'localhost',
  '': 'localhost'
}

const NGROK_PROCESS = /^ngrok(?:\.exe)?$/i
const MAX_AGENT_PORTS = 16

/** What sharing this listener asks for; null when it is not reachable on loopback. */
export function shareTargetForPort(port: WorkspacePort): NgrokShareRequest | null {
  // Why: an agent's own inspector would publish every request it captured.
  if (port.processName && NGROK_PROCESS.test(port.processName)) {
    return null
  }
  const host = LOOPBACK_HOSTS[port.connectHost.toLowerCase()]
  if (!host) {
    return null
  }
  const advertisedHttps =
    port.kind === 'workspace' && port.advertisedUrl?.toLowerCase().startsWith('https:')
  const protocol = port.protocol === 'https' || advertisedHttps ? 'https' : 'http'
  return { port: port.port, protocol, host }
}

/** An SSH forward listens on this machine, so its local end can be shared like any port. */
export function shareTargetForForward(entry: PortForwardEntry): NgrokShareRequest {
  return {
    port: entry.localPort,
    protocol: entry.advertisedProtocol === 'https' ? 'https' : 'http',
    host: 'localhost'
  }
}

export function endpointsForPort(
  snapshot: NgrokSnapshot | null,
  port: number
): readonly NgrokEndpoint[] {
  return snapshot?.endpoints.filter((endpoint) => endpoint.upstreamPort === port) ?? []
}

/** Ports of local listeners whose process is ngrok: each may be an agent's local API. */
export function ngrokAgentPortsFromScan(scan: WorkspacePortScanResult | undefined): number[] {
  const ports = (scan?.ports ?? [])
    .filter((port) => port.processName && NGROK_PROCESS.test(port.processName))
    .map((port) => port.port)
  return [...new Set(ports)].sort((a, b) => a - b).slice(0, MAX_AGENT_PORTS)
}

/** `https://abc.ngrok-free.app` → `abc.ngrok-free.app`, for compact labels. */
export function hostOfUrl(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export function publicHostOf(endpoint: NgrokEndpoint): string {
  return hostOfUrl(endpoint.publicUrl)
}
