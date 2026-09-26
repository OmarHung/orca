import { connect, type Socket } from 'node:net'
import type { DapTransport, DapTransportClose } from './dap-transport'

const CONNECT_TIMEOUT_MS = 10_000

/** Connects to a debug adapter listening on TCP (e.g. js-debug's standalone server). */
export function connectTcpDapTransport(host: string, port: number): Promise<DapTransport> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`Timed out connecting to debug adapter at ${host}:${port}`))
    }, CONNECT_TIMEOUT_MS)
    const closeListeners = new Set<(reason: DapTransportClose) => void>()
    let closeReason: DapTransportClose | null = null
    let lastError: Error | null = null

    socket.once('connect', () => {
      clearTimeout(timer)
      resolve({
        write: (data) => {
          if (!closeReason) {
            socket.write(data)
          }
        },
        onData: (listener) => {
          socket.on('data', listener)
        },
        onClose: (listener) => {
          if (closeReason) {
            listener(closeReason)
            return
          }
          closeListeners.add(listener)
        },
        close: () => socket.destroy()
      })
    })
    socket.on('error', (error) => {
      lastError = error
      clearTimeout(timer)
      reject(error)
    })
    socket.on('close', () => {
      closeReason = { code: null, signal: null, error: lastError }
      for (const listener of closeListeners) {
        listener(closeReason)
      }
    })
  })
}
