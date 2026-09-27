import { parentPort } from 'node:worker_threads'
import type { DatabaseWorkerMessage, DatabaseWorkerRequest } from './database-worker-protocol'
import { createDatabaseWorkerDispatcher } from './database-worker-dispatch'

// Worker thread entry: must stay electron-free (enforced by plain-node-entry-guard).

if (!parentPort) {
  throw new Error('Database worker must run with a parent port.')
}
const port = parentPort

const dispatch = createDatabaseWorkerDispatcher((message: DatabaseWorkerMessage) => {
  try {
    port.postMessage(message)
  } catch {
    // A non-cloneable value would otherwise leave the caller waiting forever.
    if (message.kind === 'response') {
      port.postMessage({
        kind: 'response',
        id: message.id,
        result: { ok: false, error: { message: 'Database result could not be serialized.' } }
      } satisfies DatabaseWorkerMessage)
    }
  }
})

port.on('message', (request: DatabaseWorkerRequest) => {
  void dispatch(request)
})
