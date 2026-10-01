import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureNpmPackageSetInstalled,
  isNpmPackageSetInstalled,
  type NpmPackageSet
} from './npm-package-set-installer'

let baseDir: string

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'orca-npm-set-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

/** A fake tarball: a JSON map of archive paths to file contents, as `extract` below unpacks it. */
function tarball(files: Record<string, string>): Buffer {
  return Buffer.from(JSON.stringify(files))
}

const sha256 = (payload: Buffer) => createHash('sha256').update(payload).digest('hex')

const archives: Record<string, Buffer> = {
  'https://registry.example/a.tgz': tarball({ 'package/package.json': '{"name":"a"}' }),
  'https://registry.example/b.tgz': tarball({ 'package/index.js': 'module.exports = 1' }),
  'https://registry.example/b-nested.tgz': tarball({ 'b-nested/lib.js': 'nested' })
}

function packageSet(overrides: Partial<Record<string, string>> = {}): NpmPackageSet {
  const entry = (path: string, url: string) => ({
    path,
    url,
    sha256: overrides[url] ?? sha256(archives[url]),
    sizeBytes: archives[url].length
  })
  return {
    name: 'vue-vtsls',
    version: '1.0.0',
    packages: [
      // Why nested first: the installer must place parents before their nested node_modules.
      entry('node_modules/b/node_modules/nested', 'https://registry.example/b-nested.tgz'),
      entry('node_modules/@scope/a', 'https://registry.example/a.tgz'),
      entry('node_modules/b', 'https://registry.example/b.tgz')
    ]
  }
}

function deps() {
  return {
    download: vi.fn(async (url: string) => archives[url]),
    extract: vi.fn(async (archivePath: string, destination: string) => {
      const files: Record<string, string> = JSON.parse(await readFile(archivePath, 'utf8'))
      for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(destination, path)), { recursive: true })
        await writeFile(join(destination, path), text)
      }
    })
  }
}

describe('ensureNpmPackageSetInstalled', () => {
  it('unpacks each package at its node_modules path and installs only once', async () => {
    const set = packageSet()
    const installDeps = deps()

    const installDir = await ensureNpmPackageSetInstalled(set, baseDir, installDeps)

    expect(installDir).toBe(join(baseDir, 'vue-vtsls', '1.0.0'))
    expect(await readFile(join(installDir, 'node_modules/@scope/a/package.json'), 'utf8')).toBe(
      '{"name":"a"}'
    )
    expect(await readFile(join(installDir, 'node_modules/b/index.js'), 'utf8')).toBe(
      'module.exports = 1'
    )
    expect(
      await readFile(join(installDir, 'node_modules/b/node_modules/nested/lib.js'), 'utf8')
    ).toBe('nested')
    expect(await isNpmPackageSetInstalled(set, baseDir)).toBe(true)

    await ensureNpmPackageSetInstalled(set, baseDir, installDeps)
    expect(installDeps.download).toHaveBeenCalledTimes(3)
  })

  it('shares one install between concurrent callers', async () => {
    const set = packageSet()
    const installDeps = deps()

    const [first, second] = await Promise.all([
      ensureNpmPackageSetInstalled(set, baseDir, installDeps),
      ensureNpmPackageSetInstalled(set, baseDir, installDeps)
    ])

    expect(first).toBe(second)
    expect(installDeps.download).toHaveBeenCalledTimes(3)
  })

  it('installs nothing when one package fails verification', async () => {
    const set = packageSet({ 'https://registry.example/b.tgz': '0'.repeat(64) })

    await expect(ensureNpmPackageSetInstalled(set, baseDir, deps())).rejects.toThrow(
      'node_modules/b failed SHA-256 verification'
    )

    expect(await isNpmPackageSetInstalled(set, baseDir)).toBe(false)
    expect(await readdir(join(baseDir, 'vue-vtsls'))).toEqual([])
  })

  it('refuses a package path that leaves the install directory', async () => {
    const set = packageSet()
    const escaping = { ...set, packages: [{ ...set.packages[1], path: 'node_modules/../../x' }] }

    await expect(ensureNpmPackageSetInstalled(escaping, baseDir, deps())).rejects.toThrow(
      'Invalid package path'
    )
  })
})
