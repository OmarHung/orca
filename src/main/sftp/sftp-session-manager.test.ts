import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
import { formatSftpOperation } from '../../shared/sftp-operation-format'
import type { SftpTransferProgress } from '../../shared/sftp-types'
import { FakeSftp } from './sftp-test-support'
import { SftpSessionManager, type SftpConnection } from './sftp-session-manager'

const target: SshTarget = {
  id: 'web',
  label: 'web',
  host: '203.0.113.10',
  port: 22,
  username: 'deploy'
}

class FakeConnection implements SftpConnection {
  connectCalls = 0
  disconnected = false
  systemTransport = false
  onChannel: ((channel: FakeSftp) => void) | null = null

  constructor(readonly remote: FakeSftp) {}

  async connect(): Promise<void> {
    this.connectCalls += 1
  }

  async disconnect(): Promise<void> {
    this.disconnected = true
  }

  usesSystemSshTransport(): boolean {
    return this.systemTransport
  }

  async sftp(): Promise<FakeSftp> {
    const channel = this.remote.openChannel()
    this.onChannel?.(channel)
    return channel
  }
}

let localRoot: string
let remote: FakeSftp
let connection: FakeConnection
let progress: SftpTransferProgress[]
let manager: SftpSessionManager

function createManager(idleMs = 60_000): SftpSessionManager {
  return new SftpSessionManager({
    getTarget: (id) => (id === target.id ? target : undefined),
    createConnection: () => connection,
    onProgress: (event) => progress.push(event),
    idleMs
  })
}

beforeEach(() => {
  localRoot = mkdtempSync(path.join(os.tmpdir(), 'sftp-session-'))
  remote = new FakeSftp().addDir('/srv').addFile('/srv/a.txt', 'abc').addDir('/srv/logs')
  connection = new FakeConnection(remote)
  progress = []
  manager = createManager()
})

afterEach(async () => {
  await manager.dispose()
  rmSync(localRoot, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('SftpSessionManager', () => {
  it('reuses one connection per host and lists folders first', async () => {
    expect(await manager.home('web')).toBe('/home/dev')
    const entries = await manager.list('web', '/srv')

    expect(entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ['logs', 'directory'],
      ['a.txt', 'file']
    ])
    expect(connection.connectCalls).toBe(1)
  })

  it('fails clearly for unknown hosts and hosts that need the system ssh transport', async () => {
    await expect(manager.list('missing', '/')).rejects.toThrow('SSH host not found')

    connection.systemTransport = true
    await expect(manager.list('web', '/')).rejects.toThrow(/system ssh/i)
    expect(connection.disconnected).toBe(true)
  })

  it('plans an upload without touching the remote, then runs exactly that plan', async () => {
    writeFileSync(path.join(localRoot, 'a.txt'), 'new')
    const plan = await manager.plan({
      kind: 'upload',
      targetId: 'web',
      sources: [path.join(localRoot, 'a.txt')],
      destinationDir: '/srv'
    })

    expect(plan.conflicts).toEqual(['a.txt'])
    expect(plan.operations.map(formatSftpOperation)).toEqual([
      `put ${JSON.stringify(path.join(localRoot, 'a.txt'))} "/srv/a.txt"`
    ])
    expect(remote.readText('/srv/a.txt')).toBe('abc')

    expect(await manager.execute({ planId: plan.planId, transferId: 't1' })).toEqual({
      status: 'done'
    })
    expect(remote.readText('/srv/a.txt')).toBe('new')
    expect(progress.at(-1)).toMatchObject({ transferId: 't1', transferredBytes: 3, totalBytes: 3 })
  })

  it('runs a plan at most once and never after it is discarded', async () => {
    const plan = await manager.plan({ kind: 'mkdir', targetId: 'web', path: '/srv/new' })
    await manager.execute({ planId: plan.planId, transferId: 'm1' })

    await expect(manager.execute({ planId: plan.planId, transferId: 'm2' })).rejects.toThrow(
      /expired or was already used/
    )

    const discarded = await manager.plan({ kind: 'mkdir', targetId: 'web', path: '/srv/other' })
    manager.discardPlan(discarded.planId)
    await expect(manager.execute({ planId: discarded.planId, transferId: 'm3' })).rejects.toThrow(
      /expired/
    )
    expect(remote.nodes.has('/srv/other')).toBe(false)
  })

  it('deletes only what was listed: a file added after confirming stops the delete', async () => {
    remote.addDir('/srv/keep').addFile('/srv/keep/data.txt', 'x')
    remote.addDir('/srv/old').addLink('/srv/old/to-keep', '/srv/keep')
    const plan = await manager.plan({ kind: 'remove', targetId: 'web', paths: ['/srv/old'] })

    expect(plan.operations.map(formatSftpOperation)).toEqual([
      'rm "/srv/old/to-keep"',
      'rmdir "/srv/old"'
    ])

    remote.addFile('/srv/old/late.txt', 'late')
    await expect(manager.execute({ planId: plan.planId, transferId: 'r1' })).rejects.toThrow()
    expect(remote.readText('/srv/old/late.txt')).toBe('late')
    expect(remote.readText('/srv/keep/data.txt')).toBe('x')
  })

  it('cancels a running transfer by ending its own channel', async () => {
    connection.onChannel = (channel) => {
      channel.beforeTransfer = () => manager.cancel('t2')
    }
    const plan = await manager.plan({
      kind: 'download',
      targetId: 'web',
      sources: ['/srv/a.txt'],
      destinationDir: localRoot
    })

    expect(await manager.execute({ planId: plan.planId, transferId: 't2' })).toEqual({
      status: 'cancelled'
    })
  })

  it('disconnects a host after it sits idle', async () => {
    vi.useFakeTimers()
    manager = createManager(1_000)
    await manager.list('web', '/srv')

    await vi.advanceTimersByTimeAsync(1_000)

    expect(connection.disconnected).toBe(true)
  })
})
