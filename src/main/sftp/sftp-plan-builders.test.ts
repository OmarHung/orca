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
import { formatSftpOperation } from '../../shared/sftp-operation-format'
import type { SftpPlanRequest } from '../../shared/sftp-types'
import { runSftpOperations } from './sftp-operation-runner'
import { draftSftpPlan } from './sftp-plan-builders'
import { FakeSftp } from './sftp-test-support'

let localRoot: string

beforeEach(() => {
  localRoot = mkdtempSync(path.join(os.tmpdir(), 'sftp-plan-'))
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

function local(...parts: string[]): string {
  return JSON.stringify(path.join(localRoot, ...parts))
}

async function draftLines(sftp: FakeSftp, request: SftpPlanRequest): Promise<string[]> {
  return (await draftSftpPlan(sftp, request)).operations.map(formatSftpOperation)
}

describe('draftSftpPlan', () => {
  it('downloads a folder tree, following file links but not linked folders', async () => {
    const sftp = remoteApp()
    const request: SftpPlanRequest = {
      kind: 'download',
      targetId: 'web',
      sources: ['/srv/app'],
      destinationDir: localRoot
    }

    expect((await draftLines(sftp, request)).sort()).toEqual(
      [
        `-lmkdir ${local('app')}`,
        `-lmkdir ${local('app', 'sub')}`,
        `get "/srv/app/a-link" ${local('app', 'a-link')}`,
        `get "/srv/app/a.txt" ${local('app', 'a.txt')}`,
        `get "/srv/app/sub/b.txt" ${local('app', 'sub', 'b.txt')}`
      ].sort()
    )
    expect((await draftSftpPlan(sftp, request)).totalBytes).toBe(11)
  })

  it('uploads a local folder, merging into remote folders and never following a symlink', async () => {
    const project = path.join(localRoot, 'project')
    mkdirSync(path.join(project, 'src'), { recursive: true })
    writeFileSync(path.join(project, 'src', 'main.ts'), 'code')
    writeFileSync(path.join(localRoot, 'secret.txt'), 'do not send')
    symlinkSync(path.join(localRoot, 'secret.txt'), path.join(project, 'leak.txt'))

    expect(
      await draftLines(new FakeSftp().addDir('/srv'), {
        kind: 'upload',
        targetId: 'web',
        sources: [project],
        destinationDir: '/srv'
      })
    ).toEqual([
      '-mkdir "/srv/project"',
      '-mkdir "/srv/project/src"',
      `put ${local('project', 'src', 'main.ts')} "/srv/project/src/main.ts"`
    ])
  })

  it('reports top-level names that already exist where the items would land', async () => {
    const sftp = remoteApp()
    writeFileSync(path.join(localRoot, 'a.txt'), 'local')

    const upload = await draftSftpPlan(sftp, {
      kind: 'upload',
      targetId: 'web',
      sources: [path.join(localRoot, 'a.txt')],
      destinationDir: '/srv/app'
    })
    const download = await draftSftpPlan(sftp, {
      kind: 'download',
      targetId: 'web',
      sources: ['/srv/app/a.txt', '/srv/app/sub'],
      destinationDir: localRoot
    })

    expect(upload.conflicts).toEqual(['a.txt'])
    expect(download.conflicts).toEqual(['a.txt'])
  })

  it('removes children before their folder and links without following them', async () => {
    expect(
      await draftLines(remoteApp(), { kind: 'remove', targetId: 'web', paths: ['/srv/app/sub'] })
    ).toEqual(['rm "/srv/app/sub/b.txt"', 'rmdir "/srv/app/sub"'])
  })
})

describe('draftSftpPlan move', () => {
  function move(sources: string[], destinationDir: string): SftpPlanRequest {
    return { kind: 'move', targetId: 'web', sources, destinationDir }
  }

  it('renames each item into the folder and skips items already there', async () => {
    const sftp = remoteApp()
    const plan = await draftSftpPlan(
      sftp,
      move(['/srv/app/a.txt', '/srv/app/sub/b.txt'], '/srv/app/sub/')
    )

    expect(plan.operations.map(formatSftpOperation)).toEqual([
      'rename "/srv/app/a.txt" "/srv/app/sub/a.txt"'
    ])
    await runSftpOperations(sftp, plan.operations, () => undefined)
    expect(sftp.readText('/srv/app/sub/a.txt')).toBe('abc')
    expect(sftp.readText('/srv/app/a.txt')).toBeNull()
  })

  it('moves a folder with its contents up to the parent folder', async () => {
    const sftp = remoteApp()
    const plan = await draftSftpPlan(sftp, move(['/srv/app/sub'], '/srv'))

    await runSftpOperations(sftp, plan.operations, () => undefined)

    expect(sftp.readText('/srv/sub/b.txt')).toBe('hello')
  })

  it('reports names already taken in the folder, including dangling links', async () => {
    const sftp = remoteApp().addFile('/srv/a.txt', 'other').addLink('/srv/sub', '/srv/missing')

    const plan = await draftSftpPlan(sftp, move(['/srv/app/a.txt', '/srv/app/sub'], '/srv'))

    expect(plan.conflicts).toEqual(['a.txt', 'sub'])
  })

  it('refuses a folder moved into itself or a destination that is not a folder', async () => {
    const sftp = remoteApp()

    await expect(draftSftpPlan(sftp, move(['/srv/app'], '/srv/app/sub'))).rejects.toThrow(
      'Cannot move "app" into itself.'
    )
    await expect(draftSftpPlan(sftp, move(['/srv/app/sub'], '/srv/app/a.txt'))).rejects.toThrow(
      '"/srv/app/a.txt" is not a folder.'
    )
    await expect(draftSftpPlan(sftp, move(['/srv/app/sub'], '/srv/nope'))).rejects.toThrow(
      '"/srv/nope" is not a folder.'
    )
  })
})

describe('runSftpOperations', () => {
  it('downloads a folder and reports monotonic progress up to the total', async () => {
    const sftp = remoteApp()
    const plan = await draftSftpPlan(sftp, {
      kind: 'download',
      targetId: 'web',
      sources: ['/srv/app'],
      destinationDir: localRoot
    })
    const reported: number[] = []

    await runSftpOperations(sftp, plan.operations, (progress) =>
      reported.push(progress.transferredBytes)
    )

    expect(readFileSync(path.join(localRoot, 'app', 'sub', 'b.txt'), 'utf8')).toBe('hello')
    expect(reported).toEqual([...reported].sort((a, b) => a - b))
    expect(reported.at(-1)).toBe(plan.totalBytes)
  })

  it('merges into an existing remote folder but refuses to treat a file as one', async () => {
    const sftp = new FakeSftp()
      .addDir('/srv')
      .addDir('/srv/project')
      .addFile('/srv/project/keep.txt', 'k')
      .addFile('/srv/clash', 'file')
    writeFileSync(path.join(localRoot, 'new.txt'), 'n')

    await runSftpOperations(
      sftp,
      [
        { op: 'mkdir', path: '/srv/project', keepExisting: true },
        {
          op: 'put',
          local: path.join(localRoot, 'new.txt'),
          remote: '/srv/project/new.txt',
          size: 1
        }
      ],
      () => undefined
    )

    expect(sftp.readText('/srv/project/new.txt')).toBe('n')
    expect(sftp.readText('/srv/project/keep.txt')).toBe('k')
    await expect(
      runSftpOperations(sftp, [{ op: 'mkdir', path: '/srv/clash', keepExisting: true }], () => {})
    ).rejects.toThrow('Failure')
  })

  it('leaves an existing local file untouched and no leftovers when a download fails', async () => {
    const sftp = remoteApp()
    writeFileSync(path.join(localRoot, 'a.txt'), 'original')
    sftp.beforeTransfer = () => sftp.end()

    await expect(
      runSftpOperations(
        sftp,
        [{ op: 'get', remote: '/srv/app/a.txt', local: path.join(localRoot, 'a.txt'), size: 3 }],
        () => undefined
      )
    ).rejects.toThrow('Channel ended')

    expect(readFileSync(path.join(localRoot, 'a.txt'), 'utf8')).toBe('original')
    expect(readdirSync(localRoot)).toEqual(['a.txt'])
  })

  it('replaces an existing local file only once the download completes', async () => {
    const sftp = remoteApp()
    writeFileSync(path.join(localRoot, 'a.txt'), 'original')

    await runSftpOperations(
      sftp,
      [{ op: 'get', remote: '/srv/app/a.txt', local: path.join(localRoot, 'a.txt'), size: 3 }],
      () => undefined
    )

    expect(readFileSync(path.join(localRoot, 'a.txt'), 'utf8')).toBe('abc')
    expect(readdirSync(localRoot)).toEqual(['a.txt'])
  })
})
