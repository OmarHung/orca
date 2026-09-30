import { createDapMessageReader, encodeDapMessage } from '../debug/dap-framing'
import type { DapTransport, DapTransportClose } from '../debug/dap-transport'

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const METHOD_NOT_FOUND = -32601

type JsonRpcId = number | string
type JsonRpcError = { code: number; message: string }
type JsonRpcMessage = {
  id?: JsonRpcId | null
  method?: string
  params?: unknown
  result?: unknown
  error?: JsonRpcError
}

type PendingRequest = {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

export type LspRequestOptions = { signal?: AbortSignal; timeoutMs?: number }

export type LspConnection = {
  request: (method: string, params: unknown, options?: LspRequestOptions) => Promise<unknown>
  notify: (method: string, params: unknown) => void
  onClose: (listener: (reason: DapTransportClose) => void) => void
  isClosed: () => boolean
  close: () => void
}

/** Answers a request the server sends to Orca; throwing replies "method not found". */
export type LspServerRequestHandler = (method: string, params: unknown) => unknown

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === 'object' && value !== null
}

/** JSON-RPC over the same `Content-Length` framing DAP uses. */
export function createLspConnection(
  transport: DapTransport,
  onServerRequest: LspServerRequestHandler
): LspConnection {
  const pending = new Map<JsonRpcId, PendingRequest>()
  let nextId = 1
  let closed = false

  const send = (message: Record<string, unknown>): void => {
    if (!closed) {
      transport.write(encodeDapMessage({ jsonrpc: '2.0', ...message }))
    }
  }

  const answerServerRequest = (id: JsonRpcId, method: string, params: unknown): void => {
    try {
      send({ id, result: onServerRequest(method, params) ?? null })
    } catch {
      send({ id, error: { code: METHOD_NOT_FOUND, message: `Unhandled method ${method}` } })
    }
  }

  const reader = createDapMessageReader((message) => {
    if (!isJsonRpcMessage(message)) {
      return
    }
    const { id, method } = message
    if (method !== undefined) {
      // Notifications (logs, diagnostics, progress) carry nothing navigation needs.
      if (id !== undefined && id !== null) {
        answerServerRequest(id, method, message.params)
      }
      return
    }
    if (id === undefined || id === null) {
      return
    }
    const request = pending.get(id)
    if (!request) {
      return
    }
    pending.delete(id)
    if (message.error) {
      request.reject(new Error(message.error.message))
    } else {
      request.resolve(message.result ?? null)
    }
  })
  transport.onData((chunk) => reader.push(chunk))
  transport.onClose(() => {
    closed = true
    for (const request of pending.values()) {
      request.reject(new Error('The language server exited'))
    }
    pending.clear()
  })

  return {
    request(method, params, options = {}) {
      if (closed) {
        return Promise.reject(new Error('The language server exited'))
      }
      const id = nextId++
      return new Promise((resolve, reject) => {
        const { signal } = options
        const finish = (): void => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
        }
        const abandon = (error: Error): void => {
          if (pending.delete(id)) {
            send({ method: '$/cancelRequest', params: { id } })
            finish()
            reject(error)
          }
        }
        const onAbort = (): void => abandon(new Error(`${method} was cancelled`))
        const timer = setTimeout(
          () => abandon(new Error(`${method} timed out`)),
          options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
        )
        pending.set(id, {
          resolve: (result) => {
            finish()
            resolve(result)
          },
          reject: (error) => {
            finish()
            reject(error)
          }
        })
        signal?.addEventListener('abort', onAbort, { once: true })
        send({ id, method, params })
        if (signal?.aborted) {
          onAbort()
        }
      })
    },
    notify(method, params) {
      send({ method, params })
    },
    onClose: (listener) => transport.onClose(listener),
    isClosed: () => closed,
    close: () => transport.close()
  }
}
