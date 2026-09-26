import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureDebugAdapterInstalled, type AdapterInstallDeps } from './adapter-installer'
import type { DebugAdapterArtifact } from './adapter-manifest'

const PAYLOAD = Buffer.from('fake wheel bytes')

function artifact(overrides: Partial<DebugAdapterArtifact> = {}): DebugAdapterArtifact {
  return {
    name: 'fake',
    version: '1.0.0',
    url: 'https://example.test/fake.whl',
    sha256: createHash('sha256').update(PAYLOAD).digest('hex'),
    sizeBytes: PAYLOAD.length,
    ...overrides
  }
}

let baseDir: string

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'orca-adapter-install-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

function deps(overrides: Partial<AdapterInstallDeps> = {}): AdapterInstallDeps {
  return {
    download: vi.fn(async () => PAYLOAD),
    extract: vi.fn(async (_archive: string, destination: string) => {
      await writeFile(join(destination, 'module.py'), 'x = 1')
    }),
    ...overrides
  }
}

describe('ensureDebugAdapterInstalled', () => {
  it('downloads, verifies and extracts into a versioned directory', async () => {
    const installDeps = deps()

    const dir = await ensureDebugAdapterInstalled(artifact(), baseDir, installDeps)

    expect(dir).toBe(join(baseDir, 'fake', '1.0.0'))
    await expect(readFile(join(dir, 'module.py'), 'utf8')).resolves.toBe('x = 1')
    expect(installDeps.download).toHaveBeenCalledWith('https://example.test/fake.whl')
  })

  it('reuses an existing install without downloading again', async () => {
    const first = deps()
    await ensureDebugAdapterInstalled(artifact(), baseDir, first)
    const second = deps()

    await ensureDebugAdapterInstalled(artifact(), baseDir, second)

    expect(second.download).not.toHaveBeenCalled()
  })

  it('rejects a download whose hash does not match and leaves nothing behind', async () => {
    const installDeps = deps({ download: vi.fn(async () => Buffer.from('tampered')) })

    await expect(ensureDebugAdapterInstalled(artifact(), baseDir, installDeps)).rejects.toThrow(
      /SHA-256/
    )
    expect(installDeps.extract).not.toHaveBeenCalled()
    await expect(readdir(baseDir)).resolves.toEqual([])
  })

  it('cleans up a failed extraction so the next attempt starts fresh', async () => {
    const failing = deps({
      extract: vi.fn(async () => {
        throw new Error('corrupt archive')
      })
    })

    await expect(ensureDebugAdapterInstalled(artifact(), baseDir, failing)).rejects.toThrow(
      'corrupt archive'
    )
    await expect(readdir(join(baseDir, 'fake'))).resolves.toEqual([])

    const retry = deps()
    await expect(ensureDebugAdapterInstalled(artifact(), baseDir, retry)).resolves.toBe(
      join(baseDir, 'fake', '1.0.0')
    )
  })

  it('shares one download between concurrent callers', async () => {
    const installDeps = deps()

    await Promise.all([
      ensureDebugAdapterInstalled(artifact(), baseDir, installDeps),
      ensureDebugAdapterInstalled(artifact(), baseDir, installDeps)
    ])

    expect(installDeps.download).toHaveBeenCalledTimes(1)
  })
})
