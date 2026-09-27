import { Request, type Connection } from 'tedious'

type State = {
  rows: unknown[][]
  finished: boolean
  failure: Error | null
  wake: (() => void) | null
}

/** A query's rows in batches; the server's stream pauses while a full batch waits. */
export async function* streamSqlServerRows(
  client: Connection,
  sql: string,
  batchSize: number,
  onRequest: (request: Request | null) => void
): AsyncGenerator<unknown[][]> {
  const state: State = { rows: [], finished: false, failure: null, wake: null }
  const notify = (): void => {
    state.wake?.()
    state.wake = null
  }
  const request = new Request(sql, (error) => {
    state.failure = error ?? null
    state.finished = true
    notify()
  })
  request.on('row', (columns: { value: unknown }[]) => {
    state.rows.push(columns.map((column) => column.value))
    if (state.rows.length >= batchSize) {
      request.pause()
    }
    notify()
  })
  onRequest(request)
  client.execSqlBatch(request)
  try {
    for (;;) {
      if (state.rows.length >= batchSize || (state.finished && state.rows.length > 0)) {
        const batch = state.rows.slice(0, batchSize)
        state.rows = state.rows.slice(batchSize)
        yield batch
        request.resume()
      } else if (state.failure) {
        throw state.failure
      } else if (state.finished) {
        return
      } else {
        await new Promise<void>((resolve) => (state.wake = resolve))
      }
    }
  } finally {
    onRequest(null)
    if (!state.finished) {
      // Why wait: the connection takes no other request until this one has ended.
      request.resume()
      client.cancel()
      while (!state.finished) {
        await new Promise<void>((resolve) => (state.wake = resolve))
      }
    }
  }
}
