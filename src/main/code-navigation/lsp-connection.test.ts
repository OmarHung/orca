import { describe, expect, it } from 'vitest'
import { createLspConnection } from './lsp-connection'
import { createFakeLspTransport } from './lsp-test-transport'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('createLspConnection', () => {
  it('resolves a request with the matching response', async () => {
    const fake = createFakeLspTransport()
    const connection = createLspConnection(fake.transport, () => null)

    const pending = connection.request('textDocument/definition', { a: 1 })
    const [request] = fake.sent
    expect(request).toMatchObject({ method: 'textDocument/definition', params: { a: 1 } })
    fake.reply(request.id, [{ uri: 'file:///a.ts' }])

    await expect(pending).resolves.toEqual([{ uri: 'file:///a.ts' }])
  })

  it('rejects with the server error message', async () => {
    const fake = createFakeLspTransport()
    const connection = createLspConnection(fake.transport, () => null)

    const pending = connection.request('initialize', {})
    fake.replyError(fake.sent[0].id, 'bad params')

    await expect(pending).rejects.toThrow('bad params')
  })

  it('answers server requests and reports unknown methods as not found', async () => {
    const fake = createFakeLspTransport()
    createLspConnection(fake.transport, (method) => {
      if (method === 'workspace/configuration') {
        return [null]
      }
      throw new Error('unknown')
    })

    fake.sendFromServer({ id: 7, method: 'workspace/configuration', params: { items: [{}] } })
    fake.sendFromServer({ id: 8, method: 'custom/thing' })
    await flush()

    expect(fake.sent).toEqual([
      expect.objectContaining({ id: 7, result: [null] }),
      expect.objectContaining({ id: 8, error: expect.objectContaining({ code: -32601 }) })
    ])
  })

  it('cancels a request on abort and tells the server', async () => {
    const fake = createFakeLspTransport()
    const connection = createLspConnection(fake.transport, () => null)
    const controller = new AbortController()

    const pending = connection.request('textDocument/references', {}, { signal: controller.signal })
    const requestId = fake.sent[0].id
    controller.abort()

    await expect(pending).rejects.toThrow('cancelled')
    expect(fake.sent[1]).toMatchObject({ method: '$/cancelRequest', params: { id: requestId } })
  })

  it('times out a request the server never answers', async () => {
    const fake = createFakeLspTransport()
    const connection = createLspConnection(fake.transport, () => null)

    await expect(connection.request('shutdown', null, { timeoutMs: 5 })).rejects.toThrow(
      'shutdown timed out'
    )
  })

  it('rejects pending and later requests once the server exits', async () => {
    const fake = createFakeLspTransport()
    const connection = createLspConnection(fake.transport, () => null)

    const pending = connection.request('initialize', {})
    fake.exit({ code: 1 })

    await expect(pending).rejects.toThrow('exited')
    await expect(connection.request('shutdown', null)).rejects.toThrow('exited')
    expect(connection.isClosed()).toBe(true)
  })
})
