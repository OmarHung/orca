import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { SshConnectionStatus, SshTarget } from '../../shared/ssh-types'
import { formatSftpOperation } from '../../shared/sftp-operation-format'
import type { SftpTransferProgress } from '../../shared/sftp-types'
import { FakeSftp, spawnLocalWriterFromSource } from './sftp-test-support'
import type { SshCachedCredentials } from '../ssh/connection/ssh-connection'
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
  reusableCredentials: SshCachedCredentials | null = null
  status: SshConnectionStatus = 'connected'
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

  getReusableCredentials(): SshCachedCredentials | null {
    return this.reusableCredentials
  }

  getState(): { status: SshConnectionStatus } {
    return { status: this.status }
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
    signInEndpoint: (candidate) => candidate.host,
    onProgress: (event) => progress.push(event),
    idleMs,
    spawnLocalWriter: spawnLocalWriterFromSource
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

  describe('sign-in across reconnects', () => {
    const signIn: SshCachedCredentials = { password: 'typed-once', passphrase: null }
    let host: SshTarget
    let createConnection: Mock<
      (host: SshTarget, credentials?: SshCachedCredentials) => SftpConnection
    >

    function managerRememberingSignIn(): SftpSessionManager {
      host = { ...target }
      createConnection = vi.fn<
        (host: SshTarget, credentials?: SshCachedCredentials) => SftpConnection
      >(() => connection)
      return new SftpSessionManager({
        getTarget: () => host,
        createConnection,
        signInEndpoint: (candidate) => `${candidate.host}:${candidate.port}`,
        onProgress: () => undefined,
        idleMs: 1_000,
        spawnLocalWriter: spawnLocalWriterFromSource
      })
    }

    async function goIdleWithSignIn(subject: SftpSessionManager): Promise<void> {
      vi.useFakeTimers()
      await subject.home('web')
      connection.reusableCredentials = signIn
      await vi.advanceTimersByTimeAsync(1_000)
      expect(connection.disconnected).toBe(true)
      connection = new FakeConnection(remote)
    }

    it('reconnects after idling without asking again', async () => {
      const subject = managerRememberingSignIn()
      await goIdleWithSignIn(subject)

      await subject.home('web')

      expect(createConnection).toHaveBeenLastCalledWith(host, signIn)
      await subject.dispose()
    })

    it('uses a remembered sign-in only once', async () => {
      const subject = managerRememberingSignIn()
      await goIdleWithSignIn(subject)
      await subject.home('web')
      await subject.disconnect('web')

      await subject.home('web')

      expect(createConnection).toHaveBeenLastCalledWith(host, undefined)
      await subject.dispose()
    })

    it('asks again after the user disconnects on purpose', async () => {
      const subject = managerRememberingSignIn()
      await subject.home('web')
      connection.reusableCredentials = signIn

      await subject.disconnect('web')
      connection = new FakeConnection(remote)
      await subject.home('web')

      expect(createConnection).toHaveBeenLastCalledWith(host, undefined)
      await subject.dispose()
    })

    it('asks again when the host was edited to another endpoint', async () => {
      const subject = managerRememberingSignIn()
      await goIdleWithSignIn(subject)
      host = { ...host, host: '198.51.100.9' }

      await subject.home('web')

      expect(createConnection).toHaveBeenLastCalledWith(host, undefined)
      await subject.dispose()
    })
  })

  it('replaces a connection that gave up, so reconnecting works without waiting for idle', async () => {
    await manager.home('web')
    const dead = connection
    dead.status = 'reconnection-failed'
    connection = new FakeConnection(remote)

    await manager.home('web')

    expect(dead.disconnected).toBe(true)
    expect(connection.connectCalls).toBe(1)
  })

  it('keeps a connection that is still trying, instead of replacing it', async () => {
    await manager.home('web')
    connection.status = 'reconnecting'
    const trying = connection

    await manager.home('web').catch(() => undefined)

    expect(trying.disconnected).toBe(false)
  })

  it('does not go idle in the middle of a long operation', async () => {
    vi.useFakeTimers()
    manager = createManager(1_000)
    await manager.list('web', '/srv')
    let finishReaddir: () => void = () => undefined
    const readdir = remote.openChannel().readdir.bind(remote)
    connection.sftp = async () => {
      const channel = remote.openChannel()
      channel.readdir = (dir, callback) => {
        finishReaddir = () => readdir(dir, callback)
      }
      return channel
    }
    await manager.disconnect('web')
    connection.disconnected = false
    const listing = manager.list('web', '/srv')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(connection.disconnected).toBe(false)

    finishReaddir()
    await listing
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connection.disconnected).toBe(true)
  })

  it('will not cut off a running transfer, even if another window asks', async () => {
    const plan = await manager.plan({
      kind: 'download',
      targetId: 'web',
      sources: ['/srv/a.txt'],
      destinationDir: localRoot
    })
    let startedDisconnect = false
    connection.onChannel = () => {
      startedDisconnect = true
      void manager.disconnect('web')
    }

    await manager.execute({ planId: plan.planId, transferId: 't-window' })

    expect(startedDisconnect).toBe(true)
    expect(connection.disconnected).toBe(false)
  })

  it('forgets remembered sign-ins when it shuts down', async () => {
    vi.useFakeTimers()
    const createConnection = vi.fn<
      (host: SshTarget, credentials?: SshCachedCredentials) => SftpConnection
    >(() => connection)
    const subject = new SftpSessionManager({
      getTarget: () => target,
      createConnection,
      signInEndpoint: (candidate) => candidate.host,
      onProgress: () => undefined,
      idleMs: 1_000
    })
    await subject.home('web')
    connection.reusableCredentials = { password: 'typed-once', passphrase: null }
    await vi.advanceTimersByTimeAsync(1_000)

    await subject.dispose()
    await subject.home('web')

    expect(createConnection).toHaveBeenLastCalledWith(target, undefined)
    await subject.dispose()
  })

  it('disconnects a host after it sits idle', async () => {
    vi.useFakeTimers()
    manager = createManager(1_000)
    await manager.list('web', '/srv')

    await vi.advanceTimersByTimeAsync(1_000)

    expect(connection.disconnected).toBe(true)
  })
})
