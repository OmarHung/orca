import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DebugAdapterArtifact } from './adapter-manifest'

const INSTALLED_MARKER = '.orca-installed'

export type AdapterInstallDeps = {
  download: (url: string) => Promise<Buffer>
  /** Extract `archivePath` into the existing, empty `destination` directory. */
  extract: (archivePath: string, destination: string) => Promise<void>
}

const inFlightInstalls = new Map<string, Promise<string>>()

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function install(
  artifact: DebugAdapterArtifact,
  installDir: string,
  deps: AdapterInstallDeps
): Promise<string> {
  if (await exists(join(installDir, INSTALLED_MARKER))) {
    return installDir
  }
  const payload = await deps.download(artifact.url)
  const digest = createHash('sha256').update(payload).digest('hex')
  if (digest !== artifact.sha256) {
    throw new Error(
      `Downloaded ${artifact.name} ${artifact.version} failed SHA-256 verification (got ${digest})`
    )
  }

  // Why staging + rename: a crash or failure mid-extract must never leave a half-installed adapter.
  const parentDir = join(installDir, '..')
  const stagingDir = join(parentDir, `.staging-${randomUUID()}`)
  const archivePath = `${stagingDir}.archive`
  await mkdir(stagingDir, { recursive: true })
  try {
    await writeFile(archivePath, payload)
    await deps.extract(archivePath, stagingDir)
    await writeFile(join(stagingDir, INSTALLED_MARKER), artifact.sha256)
    await rm(installDir, { recursive: true, force: true })
    await rename(stagingDir, installDir)
    return installDir
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
    await rm(archivePath, { force: true })
  }
}

/** Returns the adapter's install directory, downloading and verifying it on first use. */
export function ensureDebugAdapterInstalled(
  artifact: DebugAdapterArtifact,
  baseDir: string,
  deps: AdapterInstallDeps
): Promise<string> {
  const installDir = join(baseDir, artifact.name, artifact.version)
  const existing = inFlightInstalls.get(installDir)
  if (existing) {
    return existing
  }
  const pending = install(artifact, installDir, deps).finally(() => {
    inFlightInstalls.delete(installDir)
  })
  inFlightInstalls.set(installDir, pending)
  return pending
}
