import { describe, expect, it, vi } from 'vitest'
import { createDapMessageReader, encodeDapMessage } from './dap-framing'
import type { DapTransport, DapTransportClose } from './dap-transport'
import { startDebugSession } from './debug-session'

type Message = {
  seq: number
  type: string
  command?: string
  arguments?: Record<string, unknown>
  request_seq?: number
  success?: boolean
}

function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && 'type' in value
}

/**
 * A scripted adapter connection. `root` mimics js-debug's root session, which asks the client
 * to open a child session instead of running the program itself.
 */
function createAdapterConnection(role: 'root' | 'child'): {
  transport: DapTransport
  received: Message[]
  send: (message: Record<string, unknown>) => void
} {
  const received: Message[] = []
  let dataListener: (chunk: Buffer) => void = () => {}
  let closeListener: (reason: DapTransportClose) => void = () => {}
  let seq = 1
  const send = (message: Record<string, unknown>): void =>
    dataListener(encodeDapMessage({ seq: seq++, ...message }))
  const reply = (request: Message, body: unknown = {}): void =>
    send({
      type: 'response',
      request_seq: request.seq,
      command: request.command,
      success: true,
      body
    })
  const reader = createDapMessageReader((message) => {
    if (!isMessage(message)) {
      return
    }
    received.push(message)
    if (message.type !== 'request') {
      return
    }
    queueMicrotask(() => {
      if (message.command === 'initialize') {
        reply(message, { supportsConfigurationDoneRequest: true })
      } else if (message.command === 'launch') {
        reply(message)
        send({ type: 'event', event: 'initialized' })
        if (role === 'root') {
          send({
            type: 'request',
            command: 'startDebugging',
            arguments: { request: 'launch', configuration: { __pendingTargetId: 'target-1' } }
          })
        }
      } else if (message.command === 'threads') {
        reply(message, { threads: [{ id: role === 'child' ? 7 : 1, name: role }] })
      } else {
        reply(message)
      }
    })
  })
  return {
    received,
    send,
    transport: {
      write: (data) => reader.push(data),
      onData: (listener) => {
        dataListener = listener
      },
      onClose: (listener) => {
        closeListener = listener
      },
      close: () => closeListener({ code: 0, signal: null, error: null })
    }
  }
}

describe('startDebugSession with child sessions', () => {
  it('opens a child for startDebugging, launches it with the given configuration and breakpoints', async () => {
    const root = createAdapterConnection('root')
    const child = createAdapterConnection('child')
    const session = startDebugSession({
      id: 's1',
      adapterId: 'pwa-node',
      transport: root.transport,
      launchArguments: { type: 'pwa-node', program: '/p/app.js' },
      breakpoints: { '/p/app.js': [{ line: 3 }] },
      emit: () => {},
      openChildTransport: async () => child.transport
    })
    await session.ready

    await vi.waitFor(() =>
      expect(child.received.map((message) => message.command)).toEqual([
        'initialize',
        'launch',
        'setBreakpoints',
        'configurationDone'
      ])
    )
    expect(child.received[1].arguments).toEqual({ __pendingTargetId: 'target-1' })
    expect(root.received).toContainEqual(
      expect.objectContaining({ type: 'response', command: 'startDebugging', success: true })
    )
  })

  it('routes requests to the child that paused and sends breakpoint changes to children', async () => {
    const root = createAdapterConnection('root')
    const child = createAdapterConnection('child')
    const session = startDebugSession({
      id: 's1',
      adapterId: 'pwa-node',
      transport: root.transport,
      launchArguments: {},
      breakpoints: {},
      emit: () => {},
      openChildTransport: async () => child.transport
    })
    await session.ready
    await vi.waitFor(() => expect(child.received.length).toBeGreaterThan(2))
    child.send({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 7 } })

    await expect(session.request('threads', {})).resolves.toEqual({
      threads: [{ id: 7, name: 'child' }]
    })
    await session.request('setBreakpoints', {
      source: { path: '/p/app.js' },
      breakpoints: [{ line: 5 }]
    })
    expect(child.received.at(-1)).toMatchObject({
      command: 'setBreakpoints',
      arguments: { source: { path: '/p/app.js' }, breakpoints: [{ line: 5 }] }
    })
  })

  it('also opens grandchildren that a child session asks for (npm → node app.js)', async () => {
    const root = createAdapterConnection('root')
    const child = createAdapterConnection('child')
    const grandchild = createAdapterConnection('child')
    const pending = [child, grandchild]
    const session = startDebugSession({
      id: 's1',
      adapterId: 'pwa-node',
      transport: root.transport,
      launchArguments: {},
      breakpoints: { '/p/app.js': [{ line: 2 }] },
      emit: () => {},
      openChildTransport: async () => pending.shift()!.transport
    })
    await session.ready
    await vi.waitFor(() => expect(child.received.length).toBeGreaterThan(3))

    child.send({
      type: 'request',
      command: 'startDebugging',
      arguments: { request: 'launch', configuration: { __pendingTargetId: 'target-2' } }
    })

    await vi.waitFor(() =>
      expect(grandchild.received.map((message) => message.command)).toContain('setBreakpoints')
    )
    expect(grandchild.received[1].arguments).toEqual({ __pendingTargetId: 'target-2' })
  })

  it('refuses startDebugging when the adapter has no way to open child connections', async () => {
    const root = createAdapterConnection('root')
    const session = startDebugSession({
      id: 's1',
      adapterId: 'x',
      transport: root.transport,
      launchArguments: {},
      breakpoints: {},
      emit: () => {}
    })
    await session.ready

    await vi.waitFor(() =>
      expect(root.received).toContainEqual(
        expect.objectContaining({ type: 'response', command: 'startDebugging', success: false })
      )
    )
  })
})
