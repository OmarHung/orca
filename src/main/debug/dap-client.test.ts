import { afterEach, describe, expect, it, vi } from 'vitest'
import { DapClient } from './dap-client'
import { createDapMessageReader, encodeDapMessage } from './dap-framing'
import type { DapTransport, DapTransportClose } from './dap-transport'

type Sent = { seq: number; type: string; command?: string; arguments?: unknown } & Record<
  string,
  unknown
>

function createFakeTransport(): {
  transport: DapTransport
  sent: Sent[]
  deliver: (message: unknown) => void
  close: (reason: DapTransportClose) => void
} {
  const sent: Sent[] = []
  let dataListener: (chunk: Buffer) => void = () => {}
  let closeListener: (reason: DapTransportClose) => void = () => {}
  const reader = createDapMessageReader((message) => sent.push(message as Sent))
  return {
    sent,
    transport: {
      write: (data) => reader.push(data),
      onData: (listener) => {
        dataListener = listener
      },
      onClose: (listener) => {
        closeListener = listener
      },
      close: vi.fn()
    },
    deliver: (message) => dataListener(encodeDapMessage(message)),
    close: (reason) => closeListener(reason)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DapClient', () => {
  it('sends requests with increasing seq and resolves with the response body', async () => {
    const fake = createFakeTransport()
    const client = new DapClient(fake.transport)

    const pending = client.request('threads')
    fake.deliver({
      seq: 1,
      type: 'response',
      request_seq: fake.sent[0].seq,
      success: true,
      command: 'threads',
      body: { threads: [{ id: 1, name: 'main' }] }
    })

    await expect(pending).resolves.toEqual({ threads: [{ id: 1, name: 'main' }] })
    client.request('threads').catch(() => {})
    expect(fake.sent[1].seq).toBeGreaterThan(fake.sent[0].seq)
  })

  it('rejects when the adapter reports failure, using its message', async () => {
    const fake = createFakeTransport()
    const client = new DapClient(fake.transport)

    const pending = client.request('evaluate', { expression: 'x' })
    fake.deliver({
      seq: 1,
      type: 'response',
      request_seq: fake.sent[0].seq,
      success: false,
      command: 'evaluate',
      message: 'name x is not defined'
    })

    await expect(pending).rejects.toThrow('name x is not defined')
  })

  it('rejects a request that gets no response before its timeout', async () => {
    vi.useFakeTimers()
    const fake = createFakeTransport()
    const client = new DapClient(fake.transport)

    const pending = client.request('threads', undefined, { timeoutMs: 1000 })
    vi.advanceTimersByTime(1001)

    await expect(pending).rejects.toThrow(/timed out/)
  })

  it('forwards events to listeners', () => {
    const fake = createFakeTransport()
    const client = new DapClient(fake.transport)
    const events: unknown[] = []
    client.onEvent((event) => events.push(event))

    fake.deliver({ seq: 1, type: 'event', event: 'stopped', body: { reason: 'breakpoint' } })

    expect(events).toEqual([
      { seq: 1, type: 'event', event: 'stopped', body: { reason: 'breakpoint' } }
    ])
  })

  it('answers reverse requests with the handler result', async () => {
    const fake = createFakeTransport()
    const client = new DapClient(fake.transport)
    client.setReverseRequestHandler(async (request) => ({ echoed: request.command }))

    fake.deliver({ seq: 7, type: 'request', command: 'runInTerminal', arguments: {} })
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1))

    expect(fake.sent[0]).toMatchObject({
      type: 'response',
      request_seq: 7,
      success: true,
      command: 'runInTerminal',
      body: { echoed: 'runInTerminal' }
    })
  })

  it('answers unhandled reverse requests with a failure instead of leaving the adapter waiting', async () => {
    const fake = createFakeTransport()
    new DapClient(fake.transport)

    fake.deliver({ seq: 9, type: 'request', command: 'startDebugging', arguments: {} })
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1))

    expect(fake.sent[0]).toMatchObject({ request_seq: 9, success: false })
  })

  it('rejects pending requests and notifies listeners when the transport closes', async () => {
    const fake = createFakeTransport()
    const client = new DapClient(fake.transport)
    const closed = vi.fn()
    client.onClose(closed)

    const pending = client.request('threads')
    fake.close({ code: 1, signal: null, error: null })

    await expect(pending).rejects.toThrow(/closed/)
    expect(closed).toHaveBeenCalledWith({ code: 1, signal: null, error: null })
  })

  it('rejects new requests after the transport closed', async () => {
    const fake = createFakeTransport()
    const client = new DapClient(fake.transport)
    fake.close({ code: 0, signal: null, error: null })

    await expect(client.request('threads')).rejects.toThrow(/closed/)
  })
})
