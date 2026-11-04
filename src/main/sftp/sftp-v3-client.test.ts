import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  isSftpFailureStatus,
  isSftpStatusError,
  sftpClose,
  sftpOpen,
  sftpRead,
  sftpReaddir,
  sftpRealpath,
  sftpStat,
  sftpWrite,
  type SftpOps
} from './sftp-ops'
import { openSftpV3Session, type SftpV3Channel } from './sftp-v3-client'
import {
  FXP,
  SftpPacketReader,
  encodeSftpPacket,
  sftpString,
  sftpU32,
  sftpU64
} from './sftp-v3-protocol'

type ReceivedRequest = { type: number; id: number; reader: SftpPacketReader }

/** The far end of the stream: hears each request and sends back whatever a test scripts. */
class FakeSftpServer extends EventEmitter implements SftpV3Channel {
  readonly stderr = new EventEmitter()
  readonly requests: ReceivedRequest[] = []
  isClosed = false
  answer: (request: ReceivedRequest) => void = () => undefined

  write(data: Buffer): void {
    let rest = data
    while (rest.length > 0) {
      const length = rest.readUInt32BE()
      const reader = new SftpPacketReader(rest.subarray(4, length + 4))
      rest = rest.subarray(length + 4)
      const type = reader.u8()
      if (type === FXP.INIT) {
        reader.u32()
        continue
      }
      const request = { type, id: reader.u32(), reader }
      this.requests.push(request)
      this.answer(request)
    }
  }

  close(): void {
    this.isClosed = true
  }

  send(type: number, fields: readonly Buffer[]): void {
    this.emit('data', encodeSftpPacket(type, fields))
  }

  reply(id: number, type: number, fields: readonly Buffer[] = []): void {
    this.send(type, [sftpU32(id), ...fields])
  }

  status(id: number, code: number, message = ''): void {
    this.reply(id, FXP.STATUS, [sftpU32(code), sftpString(message), sftpString('')])
  }
}

async function start(): Promise<{ server: FakeSftpServer; sftp: SftpOps }> {
  const server = new FakeSftpServer()
  const opening = openSftpV3Session(server)
  server.send(FXP.VERSION, [sftpU32(3)])
  return { server, sftp: await opening }
}

const FILE_ATTRS = Buffer.concat([
  sftpU32(0x01 | 0x02 | 0x04 | 0x08),
  sftpU64(5_000_000_000),
  sftpU32(1000),
  sftpU32(1001),
  sftpU32(0o100644),
  sftpU32(1_700_000_000),
  sftpU32(1_700_000_001)
])

describe('starting', () => {
  it('says what ssh said when it never gets going', async () => {
    const server = new FakeSftpServer()
    const opening = openSftpV3Session(server)

    server.stderr.emit('data', Buffer.from('subsystem request failed on channel 0\n'))
    server.emit('close')

    await expect(opening).rejects.toThrow(/subsystem request failed/)
  })

  it('explains text printed ahead of SFTP, which would otherwise look like a huge packet', async () => {
    const server = new FakeSftpServer()
    const opening = openSftpV3Session(server)

    server.emit('data', Buffer.from('Welcome to web-1!\n'))

    await expect(opening).rejects.toThrow(/\.bashrc/)
    expect(server.isClosed).toBe(true)
  })

  it('refuses a server older than version 3', async () => {
    const server = new FakeSftpServer()
    const opening = openSftpV3Session(server)

    server.send(FXP.VERSION, [sftpU32(2)])

    await expect(opening).rejects.toThrow(/version 2/)
  })

  it('gives up on a host that never answers', async () => {
    vi.useFakeTimers()
    try {
      const server = new FakeSftpServer()
      const opening = openSftpV3Session(server, 1_000)
      const failure = expect(opening).rejects.toThrow(/too long/)

      await vi.advanceTimersByTimeAsync(1_000)

      await failure
      expect(server.isClosed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('requests', () => {
  it('matches replies to requests, whatever order they come back in', async () => {
    const { server, sftp } = await start()
    const first = sftpRealpath(sftp, 'one')
    const second = sftpRealpath(sftp, 'two')
    const name = (filename: string): Buffer[] => [
      sftpU32(1),
      sftpString(filename),
      sftpString(''),
      sftpU32(0)
    ]

    const [firstRequest, secondRequest] = server.requests
    if (!firstRequest || !secondRequest) {
      throw new Error('expected two requests')
    }
    server.reply(secondRequest.id, FXP.NAME, name('/two'))
    server.reply(firstRequest.id, FXP.NAME, name('/one'))

    await expect(first).resolves.toBe('/one')
    await expect(second).resolves.toBe('/two')
  })

  it('reassembles a reply split across chunks, and several in one chunk', async () => {
    const { server, sftp } = await start()
    const first = sftpStat(sftp, '/a')
    const second = sftpStat(sftp, '/b')
    const [firstRequest, secondRequest] = server.requests
    if (!firstRequest || !secondRequest) {
      throw new Error('expected two requests')
    }

    const wire = Buffer.concat([
      encodeSftpPacket(FXP.ATTRS, [sftpU32(firstRequest.id), FILE_ATTRS]),
      encodeSftpPacket(FXP.ATTRS, [sftpU32(secondRequest.id), FILE_ATTRS])
    ])
    server.emit('data', wire.subarray(0, 3))
    server.emit('data', wire.subarray(3, 30))
    server.emit('data', wire.subarray(30))

    await expect(first).resolves.toMatchObject({ size: 5_000_000_000 })
    await expect(second).resolves.toMatchObject({ uid: 1000, gid: 1001 })
  })

  it('reads file kinds and times from attributes', async () => {
    const { server, sftp } = await start()
    server.answer = ({ id }) => server.reply(id, FXP.ATTRS, [FILE_ATTRS])

    const stats = await sftpStat(sftp, '/a')

    expect(stats.isFile()).toBe(true)
    expect(stats.isDirectory()).toBe(false)
    expect(stats.mtime).toBe(1_700_000_001)
  })

  it('reports a request’s failure with its status code, which leaves the channel usable', async () => {
    const { server, sftp } = await start()
    server.answer = ({ id }) => server.status(id, 2, 'No such file')

    const error: unknown = await sftpStat(sftp, '/missing').catch((caught: unknown) => caught)

    expect(isSftpStatusError(error)).toBe(true)
    expect(error).toMatchObject({ message: 'No such file' })
    expect(server.isClosed).toBe(false)
  })

  it('reports a generic failure so that “already exists” can be told apart', async () => {
    const { server, sftp } = await start()
    server.answer = ({ id }) => server.status(id, 4)

    const error: unknown = await new Promise((resolve) => sftp.mkdir('/a', resolve))

    expect(isSftpFailureStatus(error)).toBe(true)
  })

  it('treats a reply it can’t read as the stream being broken, not as one failed request', async () => {
    const { server, sftp } = await start()
    server.answer = ({ id }) => server.reply(id, FXP.ATTRS, [sftpU32(0x01)])

    const error: unknown = await sftpStat(sftp, '/a').catch((caught: unknown) => caught)

    expect(isSftpStatusError(error)).toBe(false)
    expect(server.isClosed).toBe(true)
  })

  it('stops at an answer to a request nobody made', async () => {
    const { server, sftp } = await start()
    const pending = sftpStat(sftp, '/a')

    server.reply(999, FXP.ATTRS, [FILE_ATTRS])

    await expect(pending).rejects.toThrow(/nobody made/)
  })
})

describe('files', () => {
  it('sends the same open flags ssh2 does', async () => {
    const { server, sftp } = await start()
    server.answer = ({ id }) => server.reply(id, FXP.HANDLE, [sftpString('h')])

    await sftpOpen(sftp, '/a', 'r')
    await sftpOpen(sftp, '/a', 'w')

    const flags = server.requests.map(({ reader }) => {
      reader.string()
      return reader.u32()
    })
    expect(flags).toEqual([0x01, 0x02 | 0x08 | 0x10])
  })

  it('reads into the given place, and says 0 at the end of the file', async () => {
    const { server, sftp } = await start()
    const buffer = Buffer.alloc(8, '.')
    server.answer = ({ id }) => server.reply(id, FXP.DATA, [sftpString('abc')])

    await expect(sftpRead(sftp, Buffer.from('h'), buffer, 2, 5, 100)).resolves.toBe(3)
    expect(buffer.toString()).toBe('..abc...')

    server.answer = ({ id }) => server.status(id, 1)
    await expect(sftpRead(sftp, Buffer.from('h'), buffer, 0, 5, 200)).resolves.toBe(0)
  })

  it('refuses more file data than it asked for, instead of writing past the buffer', async () => {
    const { server, sftp } = await start()
    server.answer = ({ id }) => server.reply(id, FXP.DATA, [sftpString('too long')])

    await expect(sftpRead(sftp, Buffer.from('h'), Buffer.alloc(8), 0, 2, 0)).rejects.toThrow(
      /more file data/
    )
    expect(server.isClosed).toBe(true)
  })

  it('writes the bytes at the position given', async () => {
    const { server, sftp } = await start()
    server.answer = ({ id }) => server.status(id, 0)

    await sftpWrite(sftp, Buffer.from('h'), Buffer.from('hello'), 7)

    const [request] = server.requests
    expect(request?.reader.string()).toBe('h')
    expect(request?.reader.u64()).toBe(7)
    expect(request?.reader.string()).toBe('hello')
  })
})

describe('listing a folder', () => {
  it('reads every batch, then closes the folder', async () => {
    const { server, sftp } = await start()
    const batch = (filename: string): Buffer[] => [
      sftpU32(1),
      sftpString(filename),
      sftpString(`-rw-r--r-- 1 deploy deploy 0 Jan 1 00:00 ${filename}`),
      FILE_ATTRS
    ]
    let batches = 0
    server.answer = ({ type, id }) => {
      if (type === FXP.OPENDIR) {
        server.reply(id, FXP.HANDLE, [sftpString('d')])
      } else if (type === FXP.READDIR) {
        batches += 1
        if (batches === 3) {
          server.status(id, 1)
        } else {
          server.reply(id, FXP.NAME, batch(`f${batches}`))
        }
      } else {
        server.status(id, 0)
      }
    }

    const entries = await sftpReaddir(sftp, '/srv')

    expect(entries.map((entry) => entry.filename)).toEqual(['f1', 'f2'])
    expect(entries[0]?.attrs.isFile()).toBe(true)
    expect(server.requests.at(-1)?.type).toBe(FXP.CLOSE)
  })

  it('still closes the folder when reading it fails', async () => {
    const { server, sftp } = await start()
    server.answer = ({ type, id }) => {
      if (type === FXP.OPENDIR) {
        server.reply(id, FXP.HANDLE, [sftpString('d')])
      } else if (type === FXP.READDIR) {
        server.status(id, 3, 'Permission denied')
      } else {
        server.status(id, 0)
      }
    }

    await expect(sftpReaddir(sftp, '/srv')).rejects.toThrow('Permission denied')
    expect(server.requests.at(-1)?.type).toBe(FXP.CLOSE)
  })
})

describe('the channel going away', () => {
  it('fails what is in flight and anything asked afterwards, as a dead channel', async () => {
    const { server, sftp } = await start()
    const pending = sftpStat(sftp, '/a').catch((caught: unknown) => caught)

    server.stderr.emit('data', Buffer.from('Connection reset by peer\n'))
    server.emit('close')

    const error = await pending
    expect(error).toMatchObject({ message: expect.stringContaining('Connection reset') })
    expect(isSftpStatusError(error)).toBe(false)
    await expect(sftpStat(sftp, '/b')).rejects.toThrow(/Connection reset/)
  })

  it('treats ending it as cancelling what is in flight, and closes the process', async () => {
    const { server, sftp } = await start()
    const pending = sftpStat(sftp, '/a')

    sftp.end()

    await expect(pending).rejects.toThrow(/closed/)
    expect(server.isClosed).toBe(true)
  })

  it('reports a stream error too', async () => {
    const { server, sftp } = await start()
    const pending = sftpClose(sftp, Buffer.from('h'))

    server.emit('error', new Error('write EPIPE'))

    await expect(pending).rejects.toThrow('write EPIPE')
  })
})
