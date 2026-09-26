import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractArchive } from './archive-extract'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-extract-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('extractArchive', () => {
  it('extracts a tar.gz and drops __MACOSX metadata', async () => {
    const source = join(root, 'source')
    await mkdir(join(source, 'js-debug'), { recursive: true })
    await mkdir(join(source, '__MACOSX'), { recursive: true })
    await writeFile(join(source, 'js-debug', 'server.js'), 'ok')
    const archive = join(root, 'adapter.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', source, 'js-debug', '__MACOSX'])
    const destination = join(root, 'out')
    await mkdir(destination)

    await extractArchive(archive, destination)

    await expect(readFile(join(destination, 'js-debug', 'server.js'), 'utf8')).resolves.toBe('ok')
    await expect(readdir(destination)).resolves.toEqual(['js-debug'])
  })

  it('rejects a file that is not an archive', async () => {
    const bogus = join(root, 'bogus.tar.gz')
    await writeFile(bogus, 'not an archive')
    const destination = join(root, 'out')
    await mkdir(destination)

    await expect(extractArchive(bogus, destination)).rejects.toThrow(/Extracting/)
  })
})
