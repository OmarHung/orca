import { connect } from 'node:tls'
import type { DEBUGGER_PROBE_HOSTS } from './debug-inspector-probe'

const PROBE_TIMEOUT_MS = 800

export type PortProtocol = 'http' | 'https'

/**
 * Whether a loopback listener speaks TLS, by starting a handshake: a server hello means https,
 * a plain reply or hang-up after the TCP connect means http. Null when nothing answered in time.
 */
export function probePortProtocol(
  host: (typeof DEBUGGER_PROBE_HOSTS)[number],
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<PortProtocol | null> {
  return new Promise((resolve) => {
    let connected = false
    let settled = false
    // Why: dev servers use self-signed or mkcert certificates; only the handshake matters here.
    const socket = connect({ host, port, rejectUnauthorized: false })
    const settle = (protocol: PortProtocol | null): void => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        socket.destroy()
        resolve(protocol)
      }
    }
    const timer = setTimeout(() => settle(null), timeoutMs)
    socket.once('connect', () => {
      connected = true
    })
    socket.once('secureConnect', () => settle('https'))
    socket.once('error', (error: NodeJS.ErrnoException) => {
      // Why: a TLS alert (e.g. a client certificate required) still came from a TLS server.
      settle(error.code?.includes('_ALERT_') ? 'https' : connected ? 'http' : null)
    })
    socket.once('close', () => settle(connected ? 'http' : null))
  })
}
