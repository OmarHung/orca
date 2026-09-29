import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeSftp } from './sftp-test-support'
import { findConflicts, planDownload, planUpload, runTransfer } from './sftp-transfer'

let localRoot: string

beforeEach(() => {
  localRoot = mkdtempSync(path.join(os.tmpdir(), 'sftp-transfer-'))
})

afterEach(() => {
  rmSync(localRoot, { recursive: true, force: true })
})

function remoteApp(): FakeSftp {
  return new FakeSftp()
    .addDir('/srv')
    .addDir('/srv/app')
    .addFile('/srv/app/a.txt', 'abc')
    .addDir('/srv/app/sub')
    .addFile('/srv/app/sub/b.txt', 'hello')
    .addLink('/srv/app/a-link', '/srv/app/a.txt')
    .addLink('/srv/app/loop', '/srv/app')
}

describe('planDownload', () => {
  it('walks a remote folder, follows file links and skips linked folders', async () => {
    const plan = await planDownload(remoteApp(), ['/srv/app'], localRoot)

    expect(plan.directories).toEqual([
      path.join(localRoot, 'app'),
      path.join(localRoot, 'app', 'sub')
    ])
    expect(plan.files.map((file) => [file.source, file.size]).sort()).toEqual([
      ['/srv/app/a-link', 3],
      ['/srv/app/a.txt', 3],
      ['/srv/app/sub/b.txt', 5]
    ])
    expect(plan.totalBytes).toBe(11)
  })
})

describe('planUpload', () => {
  it('walks local folders and never follows a symlink', async () => {
    const project = path.join(localRoot, 'project')
    mkdirSync(path.join(project, 'src'), { recursive: true })
    writeFileSync(path.join(project, 'src', 'main.ts'), 'code')
    writeFileSync(path.join(localRoot, 'secret.txt'), 'do not send')
    symlinkSync(path.join(localRoot, 'secret.txt'), path.join(project, 'leak.txt'))

    const plan = await planUpload([project], '/srv')

    expect(plan.directories).toEqual(['/srv/project', '/srv/project/src'])
    expect(plan.files).toEqual([
      {
        source: path.join(project, 'src', 'main.ts'),
        destination: '/srv/project/src/main.ts',
        size: 4
      }
    ])
  })
})

describe('findConflicts', () => {
  it('reports top-level names that already exist where the items would land', async () => {
    const sftp = remoteApp()
    writeFileSync(path.join(localRoot, 'a.txt'), 'local')

    expect(
      await findConflicts('upload', sftp, [path.join(localRoot, 'a.txt')], '/srv/app')
    ).toEqual(['a.txt'])
    expect(
      await findConflicts('upload', sftp, [path.join(localRoot, 'new.txt')], '/srv/app')
    ).toEqual([])
    expect(
      await findConflicts('download', sftp, ['/srv/app/a.txt', '/srv/app/sub'], localRoot)
    ).toEqual(['a.txt'])
  })
})

describe('runTransfer', () => {
  it('downloads a folder and reports monotonic progress up to the total', async () => {
    const sftp = remoteApp()
    const plan = await planDownload(sftp, ['/srv/app'], localRoot)
    const reported: number[] = []

    await runTransfer('download', sftp, plan, (progress) =>
      reported.push(progress.transferredBytes)
    )

    expect(readFileSync(path.join(localRoot, 'app', 'sub', 'b.txt'), 'utf8')).toBe('hello')
    expect(reported).toEqual([...reported].sort((a, b) => a - b))
    expect(reported.at(-1)).toBe(plan.totalBytes)
  })

  it('uploads into existing remote folders, merging with what is there', async () => {
    const sftp = new FakeSftp()
      .addDir('/srv')
      .addDir('/srv/project')
      .addFile('/srv/project/keep.txt', 'k')
    const project = path.join(localRoot, 'project')
    mkdirSync(project)
    writeFileSync(path.join(project, 'new.txt'), 'n')

    await runTransfer('upload', sftp, await planUpload([project], '/srv'), () => undefined)

    expect(sftp.readText('/srv/project/new.txt')).toBe('n')
    expect(sftp.readText('/srv/project/keep.txt')).toBe('k')
  })

  it('leaves an existing local file untouched and no leftovers when a download fails', async () => {
    const sftp = remoteApp()
    const plan = await planDownload(sftp, ['/srv/app/a.txt'], localRoot)
    writeFileSync(path.join(localRoot, 'a.txt'), 'original')
    sftp.beforeTransfer = () => sftp.end()

    await expect(runTransfer('download', sftp, plan, () => undefined)).rejects.toThrow(
      'Channel ended'
    )

    expect(readFileSync(path.join(localRoot, 'a.txt'), 'utf8')).toBe('original')
    expect(readdirSync(localRoot)).toEqual(['a.txt'])
  })

  it('replaces an existing local file only once the download completes', async () => {
    const sftp = remoteApp()
    writeFileSync(path.join(localRoot, 'a.txt'), 'original')

    await runTransfer(
      'download',
      sftp,
      await planDownload(sftp, ['/srv/app/a.txt'], localRoot),
      () => undefined
    )

    expect(readFileSync(path.join(localRoot, 'a.txt'), 'utf8')).toBe('abc')
    expect(readdirSync(localRoot)).toEqual(['a.txt'])
  })
})
