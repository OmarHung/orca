import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { isDebuggerEndpoint } from './debug-inspector-probe'

let server: Server | null = null

function serve(contentType: string, body: string): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((request, response) => {
      response.writeHead(request.url === '/json/version' ? 200 : 404, {
        'Content-Type': contentType
      })
      response.end(body)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

describe('isDebuggerEndpoint', () => {
  it('recognizes a Node inspector', async () => {
    const port = await serve(
      'application/json; charset=UTF-8',
      JSON.stringify({ Browser: 'node.js/v24.14.0', 'Protocol-Version': '1.1' })
    )

    expect(await isDebuggerEndpoint('127.0.0.1', port)).toBe(true)
  })

  it('treats an app answering with HTML or other JSON as an app', async () => {
    const htmlPort = await serve('text/html', '<!doctype html><title>app</title>')
    expect(await isDebuggerEndpoint('127.0.0.1', htmlPort)).toBe(false)
    await new Promise<void>((resolve) => server?.close(() => resolve()))

    const jsonPort = await serve('application/json', JSON.stringify({ version: '1.0.0' }))
    expect(await isDebuggerEndpoint('127.0.0.1', jsonPort)).toBe(false)
  })

  it('treats a port nothing answers on as not a debugger', async () => {
    const port = await serve('text/plain', '')
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = null

    expect(await isDebuggerEndpoint('127.0.0.1', port)).toBe(false)
  })
})
