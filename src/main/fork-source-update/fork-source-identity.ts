import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

/**
 * Stamped into the packaged package.json (`orcaForkSource`) by
 * config/scripts/fork-maintenance/build-mac-local-arm64.mjs. Its presence marks a build made
 * from this fork's source checkout, which updates by re-syncing that checkout, not from releases.
 */
const forkSourceIdentitySchema = z.object({
  repoRoot: z.string().min(1),
  branch: z.string().min(1),
  baseTag: z.string().regex(/^v\d+\.\d+\.\d+$/),
  upstreamRemote: z.string().min(1),
  forkRemote: z.string().min(1)
})

export type ForkSourceIdentity = z.infer<typeof forkSourceIdentitySchema>

export function parseForkSourceIdentity(packageJson: unknown): ForkSourceIdentity | null {
  if (
    typeof packageJson !== 'object' ||
    packageJson === null ||
    !('orcaForkSource' in packageJson)
  ) {
    return null
  }
  const parsed = forkSourceIdentitySchema.safeParse(packageJson.orcaForkSource)
  if (!parsed.success || !path.isAbsolute(parsed.data.repoRoot)) {
    return null
  }
  return parsed.data
}

let cached: ForkSourceIdentity | null | undefined

export function readForkSourceIdentity(appPath: string): ForkSourceIdentity | null {
  if (cached !== undefined) {
    return cached
  }
  try {
    cached = parseForkSourceIdentity(
      JSON.parse(readFileSync(path.join(appPath, 'package.json'), 'utf8'))
    )
  } catch {
    cached = null
  }
  return cached
}
