import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createTcpServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LOCAL_HTTPS_TEST_CERTIFICATE,
  LOCAL_HTTPS_TEST_PRIVATE_KEY
} from '../browser/browser-local-https-test-certificate'
import { probePortProtocol } from './port-protocol-probe'

let server: Server | null = null

function listen(next: Server): Promise<number> {
  server = next
  return new Promise((resolve) => {
    next.listen(0, '127.0.0.1', () => {
      const address = next.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

function closeServer(): Promise<void> {
  const current = server
  server = null
  return new Promise((resolve) => (current ? current.close(() => resolve()) : resolve()))
}

afterEach(closeServer)

describe('probePortProtocol', () => {
  it('recognizes a TLS server with a self-signed certificate as https', async () => {
    const port = await listen(
      createHttpsServer(
        { key: LOCAL_HTTPS_TEST_PRIVATE_KEY, cert: LOCAL_HTTPS_TEST_CERTIFICATE },
        (_request, response) => response.end('ok')
      )
    )

    expect(await probePortProtocol('127.0.0.1', port)).toBe('https')
  })

  it('recognizes a plain HTTP server as http', async () => {
    const port = await listen(createHttpServer((_request, response) => response.end('ok')))

    expect(await probePortProtocol('127.0.0.1', port)).toBe('http')
  })

  it('reads a listener that hangs up on the handshake as http', async () => {
    const port = await listen(createTcpServer((socket) => socket.destroy()))

    expect(await probePortProtocol('127.0.0.1', port)).toBe('http')
  })

  it('answers null when nothing listens or nothing replies in time', async () => {
    const closedPort = await listen(createTcpServer())
    await closeServer()
    expect(await probePortProtocol('127.0.0.1', closedPort)).toBeNull()

    // Why resume: reading the discarded hello lets the socket see the probe hang up.
    const silentPort = await listen(createTcpServer((socket) => socket.resume()))
    expect(await probePortProtocol('127.0.0.1', silentPort, 100)).toBeNull()
  })
})
