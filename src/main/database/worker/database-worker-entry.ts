import { parentPort } from 'node:worker_threads'
import type { DatabaseWorkerMessage, DatabaseWorkerRequest } from './database-worker-protocol'
import { createDatabaseWorkerDispatcher } from './database-worker-dispatch'

// Entry for a worker thread (network drivers) or a forked child process (SQLite, which must be
// killable mid-statement). Must stay electron-free (enforced by plain-node-entry-guard).

type Transport = {
  post: (message: DatabaseWorkerMessage) => void
  onRequest: (listener: (request: DatabaseWorkerRequest) => void) => void
}

function resolveTransport(): Transport {
  if (parentPort) {
    const port = parentPort
    return {
      post: (message) => port.postMessage(message),
      onRequest: (listener) => port.on('message', listener)
    }
  }
  const send = process.send?.bind(process)
  if (send) {
    // Why: a child outliving a crashed Orca would hold the SQLite file open.
    process.on('disconnect', () => process.exit(0))
    return {
      post: (message) => void send(message),
      onRequest: (listener) =>
        process.on('message', (request: DatabaseWorkerRequest) => listener(request))
    }
  }
  throw new Error('Database worker must run as a worker thread or a forked process.')
}

const transport = resolveTransport()

const dispatch = createDatabaseWorkerDispatcher((message: DatabaseWorkerMessage) => {
  try {
    transport.post(message)
  } catch {
    // A non-serializable value would otherwise leave the caller waiting forever.
    if (message.kind === 'response') {
      transport.post({
        kind: 'response',
        id: message.id,
        result: { ok: false, error: { message: 'Database result could not be serialized.' } }
      })
    }
  }
})

transport.onRequest((request) => {
  void dispatch(request)
})
