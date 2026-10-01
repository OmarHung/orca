import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { removeTree } from '../../shared/windows-transient-lock-removal'
import type { AdapterInstallDeps } from '../debug/adapters/adapter-installer'

const INSTALLED_MARKER = '.orca-installed'
const PARALLEL_DOWNLOADS = 6

/** One npm tarball, pinned by hash, and where it goes under the install directory. */
export type NpmPackageArtifact = {
  /** e.g. `node_modules/@vue/typescript-plugin`, with `/` separators. */
  path: string
  url: string
  sha256: string
  sizeBytes: number
}

/** A dependency-closed set of npm packages installed together, like a `node_modules` tree. */
export type NpmPackageSet = {
  name: string
  version: string
  packages: readonly NpmPackageArtifact[]
}

const inFlightInstalls = new Map<string, Promise<string>>()

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}

function pathSegments(path: string): string[] {
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Invalid package path ${path}`)
  }
  return segments
}

/** Downloads, verifies and unpacks one tarball; npm tarballs hold a single top-level folder. */
async function unpackPackage(
  artifact: NpmPackageArtifact,
  workDir: string,
  deps: AdapterInstallDeps
): Promise<string> {
  const payload = await deps.download(artifact.url)
  const digest = createHash('sha256').update(payload).digest('hex')
  if (digest !== artifact.sha256) {
    throw new Error(`${artifact.path} failed SHA-256 verification (got ${digest})`)
  }
  const unpackDir = join(workDir, randomUUID())
  const archivePath = `${unpackDir}.tgz`
  await mkdir(unpackDir, { recursive: true })
  await writeFile(archivePath, payload)
  await deps.extract(archivePath, unpackDir)
  await rm(archivePath, { force: true })
  const entries = await readdir(unpackDir)
  if (entries.length !== 1) {
    throw new Error(`${artifact.url} does not hold a single package folder`)
  }
  return join(unpackDir, entries[0])
}

async function unpackAll(
  set: NpmPackageSet,
  workDir: string,
  deps: AdapterInstallDeps
): Promise<Map<string, string>> {
  const unpacked = new Map<string, string>()
  const queue = [...set.packages]
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        unpacked.set(next.path, await unpackPackage(next, workDir, deps))
      } catch (error) {
        queue.length = 0
        throw error
      }
    }
  }
  // Why settle all: a worker still writing after cleanup would leave files behind.
  const results = await Promise.allSettled(Array.from({ length: PARALLEL_DOWNLOADS }, worker))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) {
    throw failure.reason
  }
  return unpacked
}

async function install(
  set: NpmPackageSet,
  installDir: string,
  deps: AdapterInstallDeps
): Promise<string> {
  if (await exists(join(installDir, INSTALLED_MARKER))) {
    return installDir
  }
  for (const artifact of set.packages) {
    pathSegments(artifact.path)
  }
  // Why staging + rename: a failure part-way must never leave a half-installed tree.
  const stagingDir = join(dirname(installDir), `.staging-${randomUUID()}`)
  const workDir = `${stagingDir}.work`
  try {
    const unpacked = await unpackAll(set, workDir, deps)
    // Why shallow first: a nested `node_modules` goes inside its already-placed parent.
    const byDepth = [...set.packages].sort(
      (a, b) => pathSegments(a.path).length - pathSegments(b.path).length
    )
    for (const artifact of byDepth) {
      const source = unpacked.get(artifact.path)
      if (!source) {
        throw new Error(`${artifact.path} was not unpacked`)
      }
      const target = join(stagingDir, ...pathSegments(artifact.path))
      await mkdir(dirname(target), { recursive: true })
      await rename(source, target)
    }
    await writeFile(join(stagingDir, INSTALLED_MARKER), set.version)
    await removeTree(installDir)
    await rename(stagingDir, installDir)
    return installDir
  } finally {
    await removeTree(stagingDir)
    await removeTree(workDir)
  }
}

export function npmPackageSetInstallDir(set: NpmPackageSet, baseDir: string): string {
  return join(baseDir, set.name, set.version)
}

export function isNpmPackageSetInstalled(set: NpmPackageSet, baseDir: string): Promise<boolean> {
  return exists(join(npmPackageSetInstallDir(set, baseDir), INSTALLED_MARKER))
}

/** Returns the set's install directory, downloading and verifying every package on first use. */
export function ensureNpmPackageSetInstalled(
  set: NpmPackageSet,
  baseDir: string,
  deps: AdapterInstallDeps
): Promise<string> {
  const installDir = npmPackageSetInstallDir(set, baseDir)
  const existing = inFlightInstalls.get(installDir)
  if (existing) {
    return existing
  }
  const pending = install(set, installDir, deps).finally(() => {
    inFlightInstalls.delete(installDir)
  })
  inFlightInstalls.set(installDir, pending)
  return pending
}
