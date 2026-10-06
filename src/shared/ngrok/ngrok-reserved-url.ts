type ConfiguredSummary = { upstreamPort: number | null; url: string | null; online: boolean }

/**
 * Which ngrok.yml endpoint a share of `port` brings up: the port's own, else any whose reserved URL
 * nothing serves right now, so whichever port is shared first gets the fixed URL. Null means a
 * random URL. `borrowed` marks a definition used for another port than its own.
 */
export function configuredForShare<T extends ConfiguredSummary>(
  configured: readonly T[],
  port: number
): { entry: T; borrowed: boolean } | null {
  const own = configured.find((entry) => entry.upstreamPort === port)
  if (own && !own.online) {
    return { entry: own, borrowed: false }
  }
  const free = configured.find((entry) => entry.url !== null && !entry.online)
  return free ? { entry: free, borrowed: true } : null
}
