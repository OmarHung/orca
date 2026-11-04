import {
  encodeSftpPacket,
  FXP,
  MAX_SFTP_PACKET_BYTES,
  SFTP_VERSION,
  SftpPacketReader,
  SftpProtocolError,
  sftpU32
} from './sftp-v3-protocol'
import { SftpStatusError } from './sftp-v3-replies'

/** What this reads from `ssh -s <host> sftp`. A byte stream, which is why ssh2's client can't: it is tied to its own transport. */
export type SftpV3Channel = {
  write(data: Buffer): unknown
  close(): void
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'close', listener: () => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): unknown }
}

const STDERR_TAIL_BYTES = 2048

type PendingRequest = {
  /** Throws an SftpStatusError for this request, or anything else if the stream can't be trusted. */
  settle: (type: number, reply: SftpPacketReader) => void
  fail: (error: Error) => void
}

/** Frames packets on the stream and pairs each reply with the request it answers. */
export class SftpV3Transport {
  private readonly pending = new Map<number, PendingRequest>()
  private nextRequestId = 0
  private inbox: Buffer = Buffer.alloc(0)
  private stderrTail = ''
  private deadError: Error | null = null
  private isStarted = false
  private readonly started: Promise<void>
  private markStarted: () => void = () => undefined
  private failStart: (error: Error) => void = () => undefined
  private startTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly channel: SftpV3Channel,
    startTimeoutMs: number
  ) {
    this.started = new Promise((resolve, reject) => {
      this.markStarted = resolve
      this.failStart = reject
    })
    channel.on('data', (chunk) => this.onData(chunk))
    channel.on('error', (error) => this.die(error))
    channel.on('close', () => this.die(this.closedError()))
    channel.stderr.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES)
    })
    this.startTimer = setTimeout(
      () => this.die(new Error('The host took too long to start SFTP.')),
      startTimeoutMs
    )
    channel.write(encodeSftpPacket(FXP.INIT, [sftpU32(SFTP_VERSION)]))
  }

  whenStarted(): Promise<void> {
    return this.started
  }

  private closedError(): Error {
    const detail = this.stderrTail.trim()
    if (this.isStarted) {
      return new Error(
        detail ? `The SFTP connection closed: ${detail}` : 'The SFTP connection closed.'
      )
    }
    return new Error(
      detail ? `Couldn’t start SFTP on this host: ${detail}` : 'Couldn’t start SFTP on this host.'
    )
  }

  /** Fails what is in flight and whatever is asked from now on, and ends the process. */
  die(error: Error): void {
    if (this.deadError) {
      return
    }
    this.deadError = error
    if (this.startTimer) {
      clearTimeout(this.startTimer)
    }
    this.failStart(error)
    const requests = [...this.pending.values()]
    this.pending.clear()
    for (const request of requests) {
      request.fail(error)
    }
    this.channel.close()
  }

  private onData(chunk: Buffer): void {
    this.inbox = this.inbox.length === 0 ? chunk : Buffer.concat([this.inbox, chunk])
    while (!this.deadError && this.inbox.length >= 4) {
      const length = this.inbox.readUInt32BE()
      if (length === 0 || length > MAX_SFTP_PACKET_BYTES) {
        this.die(
          new Error(
            'The host sent something other than SFTP. A startup file such as ~/.bashrc that prints text can cause this.'
          )
        )
        return
      }
      if (this.inbox.length < length + 4) {
        return
      }
      const packet = this.inbox.subarray(4, length + 4)
      this.inbox = this.inbox.subarray(length + 4)
      this.onPacket(new SftpPacketReader(packet))
    }
  }

  private onPacket(reply: SftpPacketReader): void {
    try {
      const type = reply.u8()
      if (type === FXP.VERSION) {
        this.onVersion(reply)
        return
      }
      const id = reply.u32()
      const request = this.pending.get(id)
      if (!request) {
        throw new SftpProtocolError('The host answered an SFTP request nobody made.')
      }
      this.pending.delete(id)
      request.settle(type, reply)
    } catch (error) {
      this.die(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private onVersion(reply: SftpPacketReader): void {
    const version = reply.u32()
    if (version < SFTP_VERSION) {
      throw new SftpProtocolError(`This host only speaks SFTP version ${version}.`)
    }
    if (this.startTimer) {
      clearTimeout(this.startTimer)
    }
    this.isStarted = true
    this.markStarted()
  }

  ask<T>(
    type: number,
    fields: readonly Buffer[],
    read: (replyType: number, reply: SftpPacketReader) => T,
    fallback: T,
    callback: (error: Error | undefined, value: T) => void
  ): void {
    if (this.deadError) {
      const { deadError } = this
      queueMicrotask(() => callback(deadError, fallback))
      return
    }
    const id = this.nextRequestId
    this.nextRequestId = (id + 1) % 0x1_0000_0000
    this.pending.set(id, {
      settle: (replyType, reply) => {
        let value: T
        try {
          value = read(replyType, reply)
        } catch (error) {
          // Why rethrow the rest: a reply that doesn't parse says the stream can't be trusted.
          if (error instanceof SftpStatusError) {
            callback(error, fallback)
            return
          }
          this.pending.set(id, {
            settle: () => undefined,
            fail: (dead) => callback(dead, fallback)
          })
          throw error
        }
        callback(undefined, value)
      },
      fail: (error) => callback(error, fallback)
    })
    this.channel.write(encodeSftpPacket(type, [sftpU32(id), ...fields]))
  }
}
