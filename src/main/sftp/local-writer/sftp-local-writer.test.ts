import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SftpLocalRoot } from '../../../shared/sftp-types'
import { forkProcess } from '../../../shared/child-process/fork-process'
import { spawnLocalWriterFromSource } from '../sftp-test-support'
import { openSftpLocalWriter, type SftpLocalWriter } from './sftp-local-writer'

let dir: string
let writer: SftpLocalWriter | null

function rootOf(folder: string): SftpLocalRoot {
  const stats = statSync(folder, { bigint: true })
  return { path: folder, dev: stats.dev.toString(), ino: stats.ino.toString() }
}

async function open(folder = dir): Promise<SftpLocalWriter> {
  writer = await openSftpLocalWriter(rootOf(folder), spawnLocalWriterFromSource)
  return writer
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'sftp-local-writer-'))
  writer = null
})

afterEach(async () => {
  await writer?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('openSftpLocalWriter', () => {
  it('writes a file into place only on commit', async () => {
    const local = await open()
    await local.mkdir(['sub'])
    const handle = await local.open(['sub', 'a.txt'])
    await local.write(handle, 3, Buffer.from('def'))
    await local.write(handle, 0, Buffer.from('abc'))

    expect(readdirSync(path.join(dir, 'sub'))).not.toContain('a.txt')
    await local.commit(handle)

    expect(readFileSync(path.join(dir, 'sub', 'a.txt'), 'utf8')).toBe('abcdef')
    expect(readdirSync(path.join(dir, 'sub'))).toEqual(['a.txt'])
  })

  it('removes unfinished partial files when it is closed', async () => {
    const local = await open()
    const handle = await local.open(['a.txt'])
    await local.write(handle, 0, Buffer.from('half'))

    await local.close()
    writer = null

    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses names that leave the folder, and links where a folder should be', async () => {
    mkdirSync(path.join(dir, 'elsewhere'))
    symlinkSync(path.join(dir, 'elsewhere'), path.join(dir, 'linked'))
    const local = await open()

    await expect(local.open(['..', 'a.txt'])).rejects.toThrow('not inside the download folder')
    await expect(local.mkdir(['linked'])).rejects.toThrow()
    await expect(local.open(['linked', 'a.txt'])).rejects.toThrow('moved or replaced')
    expect(readdirSync(path.join(dir, 'elsewhere'))).toEqual([])
  })

  it('refuses a folder that is not the one that was confirmed', async () => {
    const confirmed = rootOf(dir)
    const other = path.join(dir, 'other')
    mkdirSync(other)

    await expect(
      openSftpLocalWriter({ ...confirmed, path: other }, spawnLocalWriterFromSource)
    ).rejects.toThrow('moved or replaced after the download was confirmed')
  })

  it('fails instead of hanging when the folder is gone or the helper cannot start', async () => {
    const gone = path.join(dir, 'gone')
    mkdirSync(gone)
    const root = rootOf(gone)
    rmSync(gone, { recursive: true })

    await expect(openSftpLocalWriter(root, spawnLocalWriterFromSource)).rejects.toThrow(
      'no longer a folder'
    )
    await expect(
      openSftpLocalWriter(rootOf(dir), (cwd) =>
        forkProcess({
          modulePath: path.join(dir, 'missing-entry.js'),
          cwd,
          stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        })
      )
    ).rejects.toThrow('The SFTP download helper exited')
  })
})
