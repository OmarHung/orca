import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectTcpDapTransport } from './dap-transport-tcp'

let server: Server | null = null

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

function listen(onSocket: (socket: Socket) => void): Promise<number> {
  return new Promise((resolve) => {
    server = createServer(onSocket)
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

describe('connectTcpDapTransport', () => {
  it('exchanges bytes with the adapter and reports close', async () => {
    const port = await listen((socket) => socket.on('data', (data) => socket.end(data)))
    const transport = await connectTcpDapTransport('127.0.0.1', port)
    const received: Buffer[] = []
    const onClose = vi.fn()
    transport.onData((chunk) => received.push(chunk))
    transport.onClose(onClose)

    transport.write(Buffer.from('ping'))

    await vi.waitFor(() => expect(Buffer.concat(received).toString()).toBe('ping'))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('rejects when nothing listens on the port', async () => {
    const port = await listen(() => {})
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null

    await expect(connectTcpDapTransport('127.0.0.1', port)).rejects.toThrow()
  })
})
