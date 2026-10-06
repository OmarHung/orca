const PROBE_TIMEOUT_MS = 800

export const DEBUGGER_PROBE_HOSTS = ['127.0.0.1', '::1', 'localhost'] as const

/**
 * Whether a loopback listener speaks the DevTools protocol, like the inspector js-debug opens
 * inside every Node debuggee. It shares the program's pid and cwd, so only its answer tells the
 * two ports apart.
 */
export async function isDebuggerEndpoint(
  host: (typeof DEBUGGER_PROBE_HOSTS)[number],
  port: number,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const hostPart = host.includes(':') ? `[${host}]` : host
  try {
    const response = await fetchImpl(`http://${hostPart}:${port}/json/version`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    // Why the type check first: a dev server may answer any path with a large HTML page.
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      return false
    }
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'Protocol-Version' in body
  } catch {
    return false
  }
}
