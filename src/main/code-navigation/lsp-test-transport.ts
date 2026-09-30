import { createDapMessageReader, encodeDapMessage } from '../debug/dap-framing'
import type { DapTransport, DapTransportClose } from '../debug/dap-transport'

export type FakeLspMessage = {
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

function isFakeLspMessage(value: unknown): value is FakeLspMessage {
  return typeof value === 'object' && value !== null
}

/** An in-memory language server end: records what the client sent and can reply or exit. */
export function createFakeLspTransport(): {
  transport: DapTransport
  sent: FakeLspMessage[]
  reply: (id: number | string | undefined, result: unknown) => void
  replyError: (id: number | string | undefined, message: string) => void
  sendFromServer: (message: FakeLspMessage) => void
  exit: (reason?: Partial<DapTransportClose>) => void
  closed: () => boolean
} {
  const sent: FakeLspMessage[] = []
  const dataListeners = new Set<(chunk: Buffer) => void>()
  const closeListeners = new Set<(reason: DapTransportClose) => void>()
  let closeReason: DapTransportClose | null = null
  const reader = createDapMessageReader((message) => {
    if (isFakeLspMessage(message)) {
      sent.push(message)
    }
  })
  const sendFromServer = (message: FakeLspMessage): void => {
    const chunk = encodeDapMessage({ jsonrpc: '2.0', ...message })
    for (const listener of dataListeners) {
      listener(chunk)
    }
  }
  const exit = (reason: Partial<DapTransportClose> = {}): void => {
    if (closeReason) {
      return
    }
    closeReason = { code: 0, signal: null, error: null, ...reason }
    for (const listener of closeListeners) {
      listener(closeReason)
    }
  }
  return {
    transport: {
      write: (data) => reader.push(data),
      onData: (listener) => dataListeners.add(listener),
      onClose: (listener) => {
        if (closeReason) {
          listener(closeReason)
          return
        }
        closeListeners.add(listener)
      },
      close: () => exit({ signal: 'SIGTERM' })
    },
    sent,
    reply: (id, result) => sendFromServer({ id, result }),
    replyError: (id, message) => sendFromServer({ id, error: { code: -32603, message } }),
    sendFromServer,
    exit,
    closed: () => closeReason !== null
  }
}
