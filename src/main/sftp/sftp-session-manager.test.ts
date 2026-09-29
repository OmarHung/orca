import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
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

  it('reports name clashes instead of overwriting unless asked to', async () => {
    writeFileSync(path.join(localRoot, 'a.txt'), 'new')
    const request = {
      transferId: 't1',
      targetId: 'web',
      sources: [path.join(localRoot, 'a.txt')],
      destinationDir: '/srv',
      overwrite: false
    }

    expect(await manager.transfer('upload', request)).toEqual({
      status: 'conflict',
      conflicts: ['a.txt']
    })
    expect(remote.readText('/srv/a.txt')).toBe('abc')

    expect(await manager.transfer('upload', { ...request, overwrite: true })).toEqual({
      status: 'done'
    })
    expect(remote.readText('/srv/a.txt')).toBe('new')
    expect(progress.at(-1)).toMatchObject({ transferId: 't1', transferredBytes: 3, totalBytes: 3 })
  })

  it('cancels a running transfer by ending its own channel', async () => {
    connection.onChannel = (channel) => {
      channel.beforeTransfer = () => manager.cancel('t2')
    }
    const outcome = await manager.transfer('download', {
      transferId: 't2',
      targetId: 'web',
      sources: ['/srv/a.txt'],
      destinationDir: localRoot,
      overwrite: false
    })

    expect(outcome).toEqual({ status: 'cancelled' })
  })

  it('deletes a folder without following links out of it', async () => {
    remote.addDir('/srv/keep').addFile('/srv/keep/data.txt', 'x')
    remote.addDir('/srv/old').addLink('/srv/old/to-keep', '/srv/keep')

    await manager.remove('web', ['/srv/old'])

    expect(remote.nodes.has('/srv/old')).toBe(false)
    expect(remote.readText('/srv/keep/data.txt')).toBe('x')
  })

  it('disconnects a host after it sits idle', async () => {
    vi.useFakeTimers()
    manager = createManager(1_000)
    await manager.list('web', '/srv')

    await vi.advanceTimersByTimeAsync(1_000)

    expect(connection.disconnected).toBe(true)
  })
})
