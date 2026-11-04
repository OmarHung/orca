import type { FileEntryWithStats, Stats } from 'ssh2'

// The parts of SFTP protocol version 3 (draft-ietf-secsh-filexfer-02) that SftpOps needs.
export const SFTP_VERSION = 3
/** Well above OpenSSH's own 256 KiB limit, so only something that isn't SFTP gets refused. */
export const MAX_SFTP_PACKET_BYTES = 1024 * 1024

export const FXP = {
  INIT: 1,
  VERSION: 2,
  OPEN: 3,
  CLOSE: 4,
  READ: 5,
  WRITE: 6,
  LSTAT: 7,
  FSTAT: 8,
  OPENDIR: 11,
  READDIR: 12,
  REMOVE: 13,
  MKDIR: 14,
  RMDIR: 15,
  REALPATH: 16,
  STAT: 17,
  RENAME: 18,
  STATUS: 101,
  HANDLE: 102,
  DATA: 103,
  NAME: 104,
  ATTRS: 105
} as const

export const FX_OK = 0
export const FX_EOF = 1

/** The same `open` flags ssh2 sends for `r` and `w`. */
export const OPEN_FLAGS = {
  r: 0x01,
  w: 0x02 | 0x08 | 0x10
} as const

const ATTR_SIZE = 0x01
const ATTR_UIDGID = 0x02
const ATTR_PERMISSIONS = 0x04
const ATTR_ACMODTIME = 0x08
const ATTR_EXTENDED = 0x80000000

const FILE_TYPE_MASK = 0o170000

export function sftpU32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4)
  buffer.writeUInt32BE(value)
  return buffer
}

export function sftpU64(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(8)
  buffer.writeBigUInt64BE(BigInt(value))
  return buffer
}

export function sftpString(value: string | Buffer): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  return Buffer.concat([sftpU32(bytes.length), bytes])
}

/** No attributes: the server applies its own defaults, as ssh2 does when none are given. */
export const NO_ATTRS = sftpU32(0)

export function encodeSftpPacket(type: number, fields: readonly Buffer[]): Buffer {
  const body = Buffer.concat(fields)
  return Buffer.concat([sftpU32(body.length + 1), Buffer.from([type]), body])
}

export class SftpProtocolError extends Error {}

export function statsFromAttrs(attrs: {
  mode: number
  uid: number
  gid: number
  size: number
  atime: number
  mtime: number
}): Stats {
  const isType = (type: number) => (): boolean => (attrs.mode & FILE_TYPE_MASK) === type
  return {
    ...attrs,
    isDirectory: isType(0o040000),
    isFile: isType(0o100000),
    isBlockDevice: isType(0o060000),
    isCharacterDevice: isType(0o020000),
    isSymbolicLink: isType(0o120000),
    isFIFO: isType(0o010000),
    isSocket: isType(0o140000)
  }
}

export const NO_STATS = statsFromAttrs({ mode: 0, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 })

/** Reads one packet's fields in order. Running off the end means it wasn't what it claimed to be. */
export class SftpPacketReader {
  private position = 0

  constructor(private readonly packet: Buffer) {}

  private take(length: number): Buffer {
    const end = this.position + length
    if (end > this.packet.length) {
      throw new SftpProtocolError('The host sent an SFTP reply that was cut short.')
    }
    const bytes = this.packet.subarray(this.position, end)
    this.position = end
    return bytes
  }

  hasMore(): boolean {
    return this.position < this.packet.length
  }

  u8(): number {
    return this.take(1).readUInt8()
  }

  u32(): number {
    return this.take(4).readUInt32BE()
  }

  u64(): number {
    return Number(this.take(8).readBigUInt64BE())
  }

  bytes(): Buffer {
    return this.take(this.u32())
  }

  string(): string {
    return this.bytes().toString('utf8')
  }

  stats(): Stats {
    const flags = this.u32()
    const size = flags & ATTR_SIZE ? this.u64() : 0
    const uid = flags & ATTR_UIDGID ? this.u32() : 0
    const gid = flags & ATTR_UIDGID ? this.u32() : 0
    const mode = flags & ATTR_PERMISSIONS ? this.u32() : 0
    const atime = flags & ATTR_ACMODTIME ? this.u32() : 0
    const mtime = flags & ATTR_ACMODTIME ? this.u32() : 0
    if ((flags & ATTR_EXTENDED) !== 0) {
      for (let remaining = this.u32(); remaining > 0; remaining -= 1) {
        this.bytes()
        this.bytes()
      }
    }
    return statsFromAttrs({ mode, uid, gid, size, atime, mtime })
  }

  names(): FileEntryWithStats[] {
    const entries: FileEntryWithStats[] = []
    for (let remaining = this.u32(); remaining > 0; remaining -= 1) {
      const filename = this.string()
      const longname = this.string()
      entries.push({ filename, longname, attrs: this.stats() })
    }
    return entries
  }
}
