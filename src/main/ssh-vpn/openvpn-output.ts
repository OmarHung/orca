const LOG_TAIL_LINES = 40

export type OpenVpnOutputEvent = { kind: 'ready' } | { kind: 'failed' } | { kind: 'line' }

const READY_MARKER = 'Initialization Sequence Completed'
const FATAL_MARKERS = ['AUTH_FAILED', 'Exiting due to fatal error', 'Options error:']

/** Classifies one line of `openvpn --verb 3` output. */
export function classifyOpenVpnLine(line: string): OpenVpnOutputEvent {
  // Why first: "… Completed With Errors" means routes failed to install, so the tunnel is unusable.
  if (line.includes(`${READY_MARKER} With Errors`)) {
    return { kind: 'failed' }
  }
  if (line.includes(READY_MARKER)) {
    return { kind: 'ready' }
  }
  return FATAL_MARKERS.some((marker) => line.includes(marker))
    ? { kind: 'failed' }
    : { kind: 'line' }
}

/** OpenVPN prefixes lines with `2026-09-29 10:00:00 `; the tail keeps them, error text does not. */
export function stripOpenVpnTimestamp(line: string): string {
  return line.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? /, '').trim()
}

/**
 * The user-facing reason for a failed start. OpenVPN's "Exiting due to fatal error" says nothing
 * by itself; the line before it names the cause.
 */
export function describeOpenVpnFailure(lines: readonly string[]): string {
  if (lines.some((line) => line.includes('AUTH_FAILED'))) {
    return 'The VPN server rejected the login (AUTH_FAILED)'
  }
  const meaningful = lines
    .map(stripOpenVpnTimestamp)
    .filter((line) => line && !line.includes('Exiting due to fatal error'))
  const cause = meaningful.findLast((line) => /AUTH_FAILED|error|cannot|failed/i.test(line))
  return cause ?? meaningful.at(-1) ?? 'OpenVPN exited before the tunnel came up'
}

/** Splits streamed output into lines and keeps the most recent ones. */
export class OpenVpnLogTail {
  private readonly lines: string[] = []
  private partial = ''

  /** Returns the complete lines this chunk finished. */
  push(chunk: string): string[] {
    const parts = (this.partial + chunk).split(/\r?\n/)
    this.partial = parts.pop() ?? ''
    const complete = parts.filter((line) => line.trim().length > 0)
    this.lines.push(...complete)
    if (this.lines.length > LOG_TAIL_LINES) {
      this.lines.splice(0, this.lines.length - LOG_TAIL_LINES)
    }
    return complete
  }

  snapshot(): string[] {
    return this.partial.trim() ? [...this.lines, this.partial] : [...this.lines]
  }
}
