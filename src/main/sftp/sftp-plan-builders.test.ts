import { randomBytes } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatSftpOperation } from '../../shared/sftp-operation-format'
import type { SftpLocalRoot, SftpOperation, SftpPlanRequest } from '../../shared/sftp-types'
import { runSftpOperations, type SftpRunOptions } from './sftp-operation-runner'
import { localFileIdentity } from './sftp-planned-upload'
import { draftSftpPlan } from './sftp-plan-builders'
import { FakeSftp, spawnLocalWriterFromSource } from './sftp-test-support'

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

    await runSftpOperations(
      sftp,
      plan.operations,
      (progress) => reported.push(progress.transferredBytes),
      writeInto(plan.localRoot)
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
          size: 1,
          source: localFileIdentity(lstatSync(path.join(localRoot, 'new.txt'), { bigint: true }))
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

    await expect(runGet(sftp, '/srv/app/a.txt', 'a.txt')).rejects.toThrow('Channel ended')

    expect(readFileSync(path.join(localRoot, 'a.txt'), 'utf8')).toBe('original')
    expect(readdirSync(localRoot)).toEqual(['a.txt'])
  })

  it('replaces an existing local file only once the download completes', async () => {
    const sftp = remoteApp()
    writeFileSync(path.join(localRoot, 'a.txt'), 'original')

    await runGet(sftp, '/srv/app/a.txt', 'a.txt')

    expect(readFileSync(path.join(localRoot, 'a.txt'), 'utf8')).toBe('abc')
    expect(readdirSync(localRoot)).toEqual(['a.txt'])
  })

  it('uploads a file larger than one write in order, reporting progress up to its size', async () => {
    const content = randomBytes(200 * 1024 + 7)
    writeFileSync(path.join(localRoot, 'big.bin'), content)
    const sftp = new FakeSftp().addDir('/srv')
    const plan = await draftSftpPlan(sftp, upload(['big.bin']))
    const reported: number[] = []

    await runSftpOperations(sftp, plan.operations, (progress) =>
      reported.push(progress.transferredBytes)
    )

    const node = sftp.nodes.get('/srv/big.bin')
    expect(node?.kind === 'file' && node.content.equals(content)).toBe(true)
    expect(reported).toEqual([...reported].sort((a, b) => a - b))
    expect(reported.at(-1)).toBe(content.length)
  })

  it('refuses a planned upload whose file became a link after confirmation', async () => {
    writeFileSync(path.join(localRoot, 'secret.txt'), 'do not send')
    writeFileSync(path.join(localRoot, 'a.txt'), 'planned')
    const sftp = new FakeSftp().addDir('/srv')
    const plan = await draftSftpPlan(sftp, upload(['a.txt']))
    rmSync(path.join(localRoot, 'a.txt'))
    symlinkSync(path.join(localRoot, 'secret.txt'), path.join(localRoot, 'a.txt'))

    await expect(runSftpOperations(sftp, plan.operations, () => undefined)).rejects.toThrow(
      'was replaced after the upload was confirmed'
    )
    expect(sftp.nodes.has('/srv/a.txt')).toBe(false)
  })

  it('refuses a planned upload whose path now holds a different file', async () => {
    writeFileSync(path.join(localRoot, 'a.txt'), 'planned')
    const sftp = new FakeSftp().addDir('/srv')
    const plan = await draftSftpPlan(sftp, upload(['a.txt']))
    // Why write then rename: the old file still exists while the new one is created, so it gets another inode.
    writeFileSync(path.join(localRoot, 'next.txt'), 'swapped in')
    renameSync(path.join(localRoot, 'next.txt'), path.join(localRoot, 'a.txt'))

    await expect(runSftpOperations(sftp, plan.operations, () => undefined)).rejects.toThrow(
      'was replaced after the upload was confirmed'
    )
    expect(sftp.nodes.has('/srv/a.txt')).toBe(false)
  })

  it('refuses a planned upload whose folder became a link after confirmation', async () => {
    mkdirSync(path.join(localRoot, 'project', 'keys'), { recursive: true })
    writeFileSync(path.join(localRoot, 'project', 'keys', 'id'), 'public')
    mkdirSync(path.join(localRoot, 'private'))
    writeFileSync(path.join(localRoot, 'private', 'id'), 'private key')
    const sftp = new FakeSftp().addDir('/srv')
    const plan = await draftSftpPlan(sftp, upload(['project']))
    renameSync(path.join(localRoot, 'project', 'keys'), path.join(localRoot, 'project', 'old'))
    symlinkSync(path.join(localRoot, 'private'), path.join(localRoot, 'project', 'keys'))

    await expect(runSftpOperations(sftp, plan.operations, () => undefined)).rejects.toThrow(
      'was replaced after the upload was confirmed'
    )
    expect(sftp.readText('/srv/project/keys/id')).toBeNull()
  })

  it('downloads a file larger than one read intact, reporting progress up to its size', async () => {
    const content = randomBytes(200 * 1024 + 7)
    const sftp = new FakeSftp().addDir('/srv')
    sftp.nodes.set('/srv/big.bin', { kind: 'file', content })
    const reported: number[] = []

    await runGet(sftp, '/srv/big.bin', 'big.bin', content.length, (bytes) => reported.push(bytes))

    expect(readFileSync(path.join(localRoot, 'big.bin')).equals(content)).toBe(true)
    expect(reported).toEqual([...reported].sort((a, b) => a - b))
    expect(reported.at(-1)).toBe(content.length)
  })

  it('replaces a link at the target name instead of writing through it', async () => {
    writeFileSync(path.join(localRoot, 'victim.txt'), 'keep me')
    symlinkSync(path.join(localRoot, 'victim.txt'), path.join(localRoot, 'a.txt'))

    await runGet(remoteApp(), '/srv/app/a.txt', 'a.txt')

    expect(readFileSync(path.join(localRoot, 'victim.txt'), 'utf8')).toBe('keep me')
    expect(lstatSync(path.join(localRoot, 'a.txt')).isFile()).toBe(true)
    expect(readFileSync(path.join(localRoot, 'a.txt'), 'utf8')).toBe('abc')
  })

  it('writes nothing when the confirmed folder became a link to another one', async () => {
    const selected = path.join(localRoot, 'selected')
    const victim = path.join(localRoot, 'victim')
    mkdirSync(selected)
    mkdirSync(victim)
    writeFileSync(path.join(victim, 'a.txt'), 'keep me')
    const sftp = remoteApp()
    const plan = await draftSftpPlan(sftp, {
      kind: 'download',
      targetId: 'web',
      sources: ['/srv/app/a.txt'],
      destinationDir: selected
    })
    renameSync(selected, path.join(localRoot, 'selected-old'))
    symlinkSync(victim, selected)

    await expect(
      runSftpOperations(sftp, plan.operations, () => undefined, writeInto(plan.localRoot))
    ).rejects.toThrow('moved or replaced after the download was confirmed')

    expect(readdirSync(victim)).toEqual(['a.txt'])
    expect(readFileSync(path.join(victim, 'a.txt'), 'utf8')).toBe('keep me')
  })

  it('stops when a folder inside the download is replaced by a link mid-way', async () => {
    const victim = path.join(localRoot, 'victim')
    mkdirSync(victim)
    const destination = path.join(localRoot, 'inbox')
    mkdirSync(destination)
    const sftp = remoteApp()
    const plan = await draftSftpPlan(sftp, {
      kind: 'download',
      targetId: 'web',
      sources: ['/srv/app'],
      destinationDir: destination
    })
    const sub = path.join(destination, 'app', 'sub')
    // Why the hook: swap once the folders exist, before the file inside `sub` is written.
    sftp.beforeTransfer = () => {
      if (lstatSync(sub, { throwIfNoEntry: false })?.isDirectory()) {
        rmSync(sub, { recursive: true })
        symlinkSync(victim, sub)
      }
    }

    await expect(
      runSftpOperations(sftp, plan.operations, () => undefined, writeInto(plan.localRoot))
    ).rejects.toThrow('moved or replaced after the download was confirmed')

    expect(readdirSync(victim)).toEqual([])
  })

  it('refuses a local step outside the confirmed folder', async () => {
    const operations: SftpOperation[] = [
      { op: 'lmkdir', path: path.join(os.tmpdir(), 'elsewhere') }
    ]

    await expect(
      runSftpOperations(new FakeSftp(), operations, () => undefined, writeInto(rootOf(localRoot)))
    ).rejects.toThrow('outside the folder this download was confirmed into')
  })
})

function writeInto(root: SftpLocalRoot | undefined): SftpRunOptions {
  return { localRoot: root, spawnLocalWriter: spawnLocalWriterFromSource }
}

function rootOf(dir: string): SftpLocalRoot {
  const stats = statSync(dir, { bigint: true })
  return { path: dir, dev: stats.dev.toString(), ino: stats.ino.toString() }
}

function runGet(
  sftp: FakeSftp,
  remote: string,
  name: string,
  size = 3,
  onTransferred: (bytes: number) => void = () => undefined
): Promise<void> {
  return runSftpOperations(
    sftp,
    [{ op: 'get', remote, local: path.join(localRoot, name), size }],
    (progress) => onTransferred(progress.transferredBytes),
    writeInto(rootOf(localRoot))
  )
}

function upload(names: string[]): SftpPlanRequest {
  return {
    kind: 'upload',
    targetId: 'web',
    sources: names.map((name) => path.join(localRoot, name)),
    destinationDir: '/srv'
  }
}
