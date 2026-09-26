import type { DebugProtocol } from '@vscode/debugprotocol'
import { createDapMessageReader, encodeDapMessage } from './dap-framing'
import type { DapTransport, DapTransportClose } from './dap-transport'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

type PendingRequest = {
  command: string
  resolve: (body: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

export type DapReverseRequestHandler = (request: DebugProtocol.Request) => Promise<unknown>

export type DapRequestOptions = {
  /** `null` disables the timeout, for requests that legitimately block (e.g. `launch`). */
  timeoutMs?: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isResponse(message: Record<string, unknown>): message is Record<string, unknown> & {
  type: 'response'
  request_seq: number
  success: boolean
} {
  return (
    message.type === 'response' &&
    typeof message.request_seq === 'number' &&
    typeof message.success === 'boolean'
  )
}

function isEvent(message: unknown): message is DebugProtocol.Event {
  return isRecord(message) && message.type === 'event' && typeof message.event === 'string'
}

function isRequest(message: unknown): message is DebugProtocol.Request {
  return (
    isRecord(message) &&
    message.type === 'request' &&
    typeof message.command === 'string' &&
    typeof message.seq === 'number'
  )
}

/** One Debug Adapter Protocol connection: request/response pairing, events and reverse requests. */
export class DapClient {
  private nextSeq = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly eventListeners = new Set<(event: DebugProtocol.Event) => void>()
  private readonly closeListeners = new Set<(reason: DapTransportClose) => void>()
  private reverseRequestHandler: DapReverseRequestHandler | null = null
  private closed = false

  constructor(private readonly transport: DapTransport) {
    const reader = createDapMessageReader((message) => this.handleMessage(message))
    transport.onData((chunk) => reader.push(chunk))
    transport.onClose((reason) => this.handleClose(reason))
  }

  request(command: string, args?: unknown, options: DapRequestOptions = {}): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error(`Debug adapter connection closed before "${command}"`))
    }
    const seq = this.nextSeq++
    const timeoutMs =
      options.timeoutMs === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : options.timeoutMs
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(seq)
              reject(new Error(`Debug adapter request "${command}" timed out after ${timeoutMs}ms`))
            }, timeoutMs)
      this.pending.set(seq, { command, resolve, reject, timer })
      this.send({
        seq,
        type: 'request',
        command,
        ...(args === undefined ? {} : { arguments: args })
      })
    })
  }

  onEvent(listener: (event: DebugProtocol.Event) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onClose(listener: (reason: DapTransportClose) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  setReverseRequestHandler(handler: DapReverseRequestHandler | null): void {
    this.reverseRequestHandler = handler
  }

  dispose(): void {
    this.transport.close()
    this.handleClose({ code: null, signal: null, error: null })
  }

  private send(message: Record<string, unknown>): void {
    this.transport.write(encodeDapMessage(message))
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message)) {
      return
    }
    if (isResponse(message)) {
      this.handleResponse(message)
    } else if (isEvent(message)) {
      for (const listener of this.eventListeners) {
        listener(message)
      }
    } else if (isRequest(message)) {
      void this.handleReverseRequest(message)
    }
  }

  private handleResponse(
    message: Record<string, unknown> & { request_seq: number; success: boolean }
  ): void {
    const pending = this.pending.get(message.request_seq)
    if (!pending) {
      return
    }
    this.pending.delete(message.request_seq)
    if (pending.timer) {
      clearTimeout(pending.timer)
    }
    if (message.success) {
      pending.resolve(message.body)
      return
    }
    const detail = typeof message.message === 'string' ? message.message : 'request failed'
    pending.reject(new Error(detail))
  }

  private async handleReverseRequest(request: DebugProtocol.Request): Promise<void> {
    const base = { type: 'response', request_seq: request.seq, command: request.command }
    const handler = this.reverseRequestHandler
    if (!handler) {
      this.sendIfOpen({ ...base, success: false, message: `Unsupported: ${request.command}` })
      return
    }
    try {
      const body = await handler(request)
      this.sendIfOpen({ ...base, success: true, ...(body === undefined ? {} : { body }) })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.sendIfOpen({ ...base, success: false, message: detail })
    }
  }

  private sendIfOpen(message: Record<string, unknown>): void {
    if (!this.closed) {
      this.send({ seq: this.nextSeq++, ...message })
    }
  }

  private handleClose(reason: DapTransportClose): void {
    if (this.closed) {
      return
    }
    this.closed = true
    for (const [seq, pending] of this.pending) {
      this.pending.delete(seq)
      if (pending.timer) {
        clearTimeout(pending.timer)
      }
      pending.reject(new Error(`Debug adapter connection closed during "${pending.command}"`))
    }
    for (const listener of this.closeListeners) {
      listener(reason)
    }
  }
}
