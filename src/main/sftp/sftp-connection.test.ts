import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { toSftpConnection } from './sftp-connection'
import type { SftpOps } from './sftp-ops'
import { FakeSftp } from './sftp-test-support'
import type { SftpV3Channel } from './sftp-v3-client'
import { encodeSftpPacket, FXP, sftpU32 } from './sftp-v3-protocol'

class AnsweringChannel extends EventEmitter implements SftpV3Channel {
  readonly stderr = new EventEmitter()

  write(): void {
    this.emit('data', encodeSftpPacket(FXP.VERSION, [sftpU32(3)]))
  }

  close(): void {
    this.emit('close')
  }
}

function transport(isSystemSsh: boolean, ssh2Sftp: SftpOps = new FakeSftp()) {
  return {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    getReusableCredentials: () => null,
    getState: () => ({ status: 'connected' as const }),
    usesSystemSshTransport: () => isSystemSsh,
    sftp: vi.fn(async () => ssh2Sftp),
    exec: vi.fn(async () => new AnsweringChannel())
  }
}

describe('toSftpConnection', () => {
  it('keeps using ssh2 where it can carry the host', async () => {
    const ssh2Sftp = new FakeSftp()
    const connection = transport(false, ssh2Sftp)

    await expect(toSftpConnection(connection).sftp()).resolves.toBe(ssh2Sftp)
    expect(connection.exec).not.toHaveBeenCalled()
  })

  it('runs the sftp subsystem through system ssh otherwise, unwrapped and watched for stalls', async () => {
    const connection = transport(true)

    const sftp = await toSftpConnection(connection).sftp()

    expect(connection.exec).toHaveBeenCalledWith('sftp', {
      wrapCommand: false,
      subsystem: true,
      keepAlive: true
    })
    expect(connection.sftp).not.toHaveBeenCalled()
    expect(sftp).toBeDefined()
  })
})
