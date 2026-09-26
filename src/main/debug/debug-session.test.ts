import { describe, expect, it, vi } from 'vitest'
import type { DebugSessionEvent } from '../../shared/debug/debug-session-types'
import { createDapMessageReader, encodeDapMessage } from './dap-framing'
import type { DapTransport, DapTransportClose } from './dap-transport'
import { startDebugSession } from './debug-session'

type Request = { seq: number; command: string; arguments?: Record<string, unknown> }

/** A scripted adapter that behaves like debugpy: `initialized` arrives before the `launch` response. */
function createFakeAdapter(options: { failLaunch?: boolean } = {}): {
  transport: DapTransport
  commands: string[]
  requests: Request[]
} {
  const commands: string[] = []
  const requests: Request[] = []
  let dataListener: (chunk: Buffer) => void = () => {}
  let closeListener: (reason: DapTransportClose) => void = () => {}
  let seq = 1000
  let pendingLaunchSeq: number | null = null
  const reply = (request: Request, body?: unknown, success = true): void => {
    dataListener(
      encodeDapMessage({
        seq: seq++,
        type: 'response',
        request_seq: request.seq,
        command: request.command,
        success,
        ...(success ? { body } : { message: 'launch failed: no such file' })
      })
    )
  }
  const emit = (event: string, body?: unknown): void => {
    dataListener(encodeDapMessage({ seq: seq++, type: 'event', event, body }))
  }
  const reader = createDapMessageReader((message) => {
    const request = message as Request
    commands.push(request.command)
    requests.push(request)
    queueMicrotask(() => {
      switch (request.command) {
        case 'initialize':
          reply(request, {
            supportsConfigurationDoneRequest: true,
            exceptionBreakpointFilters: [{ filter: 'raised', label: 'Raised' }]
          })
          break
        case 'launch':
          if (options.failLaunch) {
            reply(request, undefined, false)
            return
          }
          pendingLaunchSeq = request.seq
          emit('initialized')
          break
        case 'configurationDone':
          reply(request)
          if (pendingLaunchSeq !== null) {
            reply({ seq: pendingLaunchSeq, command: 'launch' })
          }
          break
        case 'disconnect':
          reply(request)
          emit('terminated')
          break
        default:
          reply(request, {})
      }
    })
  })
  return {
    commands,
    requests,
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

describe('startDebugSession', () => {
  it('configures breakpoints between initialized and the launch response', async () => {
    const adapter = createFakeAdapter()
    const events: DebugSessionEvent[] = []

    await startDebugSession({
      id: 's1',
      adapterId: 'debugpy',
      transport: adapter.transport,
      launchArguments: { program: '/p/app.py' },
      breakpoints: { '/p/app.py': [{ line: 3 }] },
      emit: (event) => events.push(event)
    }).ready

    expect(adapter.commands).toEqual([
      'initialize',
      'launch',
      'setBreakpoints',
      'setExceptionBreakpoints',
      'configurationDone'
    ])
    expect(adapter.requests[2].arguments).toEqual({
      source: { path: '/p/app.py' },
      breakpoints: [{ line: 3 }]
    })
    expect(events.filter((event) => event.kind === 'phase').map((event) => event.phase)).toEqual([
      'starting',
      'running'
    ])
  })

  it('forwards adapter events and ends the session when the adapter terminates', async () => {
    const adapter = createFakeAdapter()
    const events: DebugSessionEvent[] = []
    const session = startDebugSession({
      id: 's1',
      adapterId: 'debugpy',
      transport: adapter.transport,
      launchArguments: {},
      breakpoints: {},
      emit: (event) => events.push(event)
    })
    await session.ready

    await session.stop()

    await vi.waitFor(() =>
      expect(events).toContainEqual({ kind: 'phase', sessionId: 's1', phase: 'ended' })
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'dap-event',
        event: expect.objectContaining({ event: 'terminated' })
      })
    )
  })

  it('reports a failed launch with the adapter message and ends the session', async () => {
    const adapter = createFakeAdapter({ failLaunch: true })
    const events: DebugSessionEvent[] = []

    await expect(
      startDebugSession({
        id: 's1',
        adapterId: 'debugpy',
        transport: adapter.transport,
        launchArguments: {},
        breakpoints: {},
        emit: (event) => events.push(event)
      }).ready
    ).rejects.toThrow('launch failed: no such file')

    expect(events).toContainEqual({
      kind: 'phase',
      sessionId: 's1',
      phase: 'ended',
      message: 'launch failed: no such file'
    })
  })
})
