/** What one line of `ngrok --log stdout --log-format json` says about the agent's startup. */
export type NgrokAgentLogEvent =
  | { kind: 'web-address'; address: string }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string }
  /** A non-fatal error the agent keeps retrying, e.g. a dropped connection. */
  | { kind: 'error'; message: string }
  | { kind: 'other' }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null
}

/**
 * The first line of an agent error plus its ERR_NGROK code, e.g. "authentication failed: This
 * ngrok session is not authenticated. (ERR_NGROK_4018)"; ngrok pads the rest with sign-up links.
 */
export function describeNgrokError(err: string): string {
  const first =
    err
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? err.trim()
  const code = err.match(/ERR_NGROK_\d+/)?.[0]
  return code && !first.includes(code) ? `${first} (${code})` : first
}

export function classifyNgrokLogLine(line: string): NgrokAgentLogEvent {
  let record: Record<string, unknown> | null
  try {
    record = asRecord(JSON.parse(line))
  } catch {
    return { kind: 'other' }
  }
  if (!record) {
    return { kind: 'other' }
  }
  const { msg, lvl, err, addr } = record
  if (msg === 'starting web service' && typeof addr === 'string') {
    return { kind: 'web-address', address: addr }
  }
  if (msg === 'client session established') {
    return { kind: 'ready' }
  }
  const message = typeof err === 'string' && err !== '<nil>' ? describeNgrokError(err) : null
  // Why crit or "terminating": "eror" alone also covers reconnects the agent recovers from.
  if (lvl === 'crit' || msg === 'terminating with error') {
    return { kind: 'failed', message: message ?? (typeof msg === 'string' ? msg : 'ngrok failed') }
  }
  return lvl === 'eror' && message ? { kind: 'error', message } : { kind: 'other' }
}

/** Splits streamed output into whole lines, holding back a trailing partial one. */
export function createLineSplitter(): (chunk: string) => string[] {
  let pending = ''
  return (chunk) => {
    const parts = (pending + chunk).split(/\r?\n/)
    pending = parts.pop() ?? ''
    return parts.filter((part) => part.trim().length > 0)
  }
}
