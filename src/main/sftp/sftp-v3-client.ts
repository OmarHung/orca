import type { FileEntryWithStats, Stats } from 'ssh2'
import type { SftpOps } from './sftp-ops'
import {
  FX_EOF,
  FXP,
  NO_ATTRS,
  NO_STATS,
  OPEN_FLAGS,
  SftpProtocolError,
  sftpString,
  sftpU32,
  sftpU64
} from './sftp-v3-protocol'
import { expectOk, expectType, readStatus, unexpectedReply } from './sftp-v3-replies'
import { SftpV3Transport, type SftpV3Channel } from './sftp-v3-transport'

export type { SftpV3Channel } from './sftp-v3-transport'

/** A login with a hardware key can take this long, since it waits for a touch. */
const DEFAULT_START_TIMEOUT_MS = 60_000

/** The SFTP calls the files pane makes, over any byte stream that speaks SFTP version 3. */
class SftpV3Client implements SftpOps {
  constructor(private readonly transport: SftpV3Transport) {}

  private askDone(
    type: number,
    fields: readonly Buffer[],
    callback: (error?: Error | null) => void
  ): void {
    this.transport.ask(type, fields, expectOk, undefined, (error) => callback(error))
  }

  private askStats(
    type: number,
    field: Buffer,
    callback: (error: Error | undefined, stats: Stats) => void
  ): void {
    this.transport.ask(
      type,
      [field],
      (replyType, reply) => {
        expectType(FXP.ATTRS, replyType, reply)
        return reply.stats()
      },
      NO_STATS,
      callback
    )
  }

  private askHandle(
    type: number,
    fields: readonly Buffer[],
    callback: (error: Error | undefined, handle: Buffer) => void
  ): void {
    this.transport.ask(
      type,
      fields,
      (replyType, reply) => {
        expectType(FXP.HANDLE, replyType, reply)
        // Why copy: the handle outlives the packet it came in.
        return Buffer.from(reply.bytes())
      },
      Buffer.alloc(0),
      callback
    )
  }

  readdir(
    path: string,
    callback: (error: Error | undefined, list: FileEntryWithStats[]) => void
  ): void {
    this.askHandle(FXP.OPENDIR, [sftpString(path)], (openError, handle) => {
      if (openError) {
        callback(openError, [])
        return
      }
      this.readAllEntries(handle, [], callback)
    })
  }

  private readAllEntries(
    handle: Buffer,
    entries: readonly FileEntryWithStats[],
    callback: (error: Error | undefined, list: FileEntryWithStats[]) => void
  ): void {
    this.transport.ask<FileEntryWithStats[] | null>(
      FXP.READDIR,
      [sftpString(handle)],
      (replyType, reply) => {
        if (replyType !== FXP.NAME) {
          // Why not expectType: a directory's end comes as a status, which isn't a failure.
          const status = replyType === FXP.STATUS ? readStatus(reply) : null
          if (status?.code === FX_EOF) {
            return null
          }
          throw status ?? unexpectedReply(replyType)
        }
        return reply.names()
      },
      null,
      (error, batch) => {
        if (batch && !error) {
          this.readAllEntries(handle, [...entries, ...batch], callback)
          return
        }
        this.close(handle, () => callback(error, error ? [] : [...entries]))
      }
    )
  }

  stat(path: string, callback: (error: Error | undefined, stats: Stats) => void): void {
    this.askStats(FXP.STAT, sftpString(path), callback)
  }

  lstat(path: string, callback: (error: Error | undefined, stats: Stats) => void): void {
    this.askStats(FXP.LSTAT, sftpString(path), callback)
  }

  fstat(handle: Buffer, callback: (error: Error | undefined, stats: Stats) => void): void {
    this.askStats(FXP.FSTAT, sftpString(handle), callback)
  }

  realpath(path: string, callback: (error: Error | undefined, absPath: string) => void): void {
    this.transport.ask(
      FXP.REALPATH,
      [sftpString(path)],
      (replyType, reply) => {
        expectType(FXP.NAME, replyType, reply)
        const [first] = reply.names()
        if (!first) {
          throw unexpectedReply(replyType)
        }
        return first.filename
      },
      '',
      callback
    )
  }

  mkdir(path: string, callback: (error?: Error | null) => void): void {
    this.askDone(FXP.MKDIR, [sftpString(path), NO_ATTRS], callback)
  }

  rmdir(path: string, callback: (error?: Error | null) => void): void {
    this.askDone(FXP.RMDIR, [sftpString(path)], callback)
  }

  unlink(path: string, callback: (error?: Error | null) => void): void {
    this.askDone(FXP.REMOVE, [sftpString(path)], callback)
  }

  rename(srcPath: string, destPath: string, callback: (error?: Error | null) => void): void {
    this.askDone(FXP.RENAME, [sftpString(srcPath), sftpString(destPath)], callback)
  }

  open(
    path: string,
    mode: 'r' | 'w',
    callback: (error: Error | undefined, handle: Buffer) => void
  ): void {
    this.askHandle(FXP.OPEN, [sftpString(path), sftpU32(OPEN_FLAGS[mode]), NO_ATTRS], callback)
  }

  read(
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error: Error | undefined, bytesRead: number) => void
  ): void {
    this.transport.ask(
      FXP.READ,
      [sftpString(handle), sftpU64(position), sftpU32(length)],
      (replyType, reply) => {
        if (replyType === FXP.STATUS) {
          const status = readStatus(reply)
          if (status?.code === FX_EOF) {
            return 0
          }
          throw status ?? unexpectedReply(replyType)
        }
        expectType(FXP.DATA, replyType, reply)
        const data = reply.bytes()
        if (data.length > length) {
          throw new SftpProtocolError('The host sent more file data than was asked for.')
        }
        data.copy(buffer, offset)
        return data.length
      },
      0,
      callback
    )
  }

  write(
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error?: Error | null) => void
  ): void {
    this.askDone(
      FXP.WRITE,
      [sftpString(handle), sftpU64(position), sftpString(buffer.subarray(offset, offset + length))],
      callback
    )
  }

  close(handle: Buffer, callback: (error?: Error | null) => void): void {
    this.askDone(FXP.CLOSE, [sftpString(handle)], callback)
  }

  /** Cancels whatever is in flight, which is how a transfer gets stopped part way through. */
  end(): void {
    this.transport.die(new Error('The SFTP connection closed.'))
  }
}

/** Starts SFTP over a stream, settling once the host has answered or it is clear it won't. */
export async function openSftpV3Session(
  channel: SftpV3Channel,
  startTimeoutMs = DEFAULT_START_TIMEOUT_MS
): Promise<SftpOps> {
  const transport = new SftpV3Transport(channel, startTimeoutMs)
  await transport.whenStarted()
  return new SftpV3Client(transport)
}
