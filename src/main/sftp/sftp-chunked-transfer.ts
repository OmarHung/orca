// Why these: ssh2's fastGet/fastPut defaults, so transfers keep their throughput on high-latency links.
export const CHUNK_BYTES = 32 * 1024
const MAX_CHUNKS_IN_FLIGHT = 64

/**
 * Runs `transfer` over each chunk of a `size`-byte file with up to 64 chunks pending at once,
 * reporting bytes done as chunks finish. Stops starting chunks at the first failure.
 */
export async function transferInChunks(
  size: number,
  transfer: (position: number, length: number) => Promise<void>,
  onStep: (transferred: number) => void
): Promise<void> {
  let nextPosition = 0
  let transferred = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && nextPosition < size) {
      const position = nextPosition
      const length = Math.min(CHUNK_BYTES, size - position)
      nextPosition += length
      try {
        await transfer(position, length)
      } catch (error) {
        failed = true
        throw error
      }
      transferred += length
      onStep(transferred)
    }
  }
  const workers = Math.min(MAX_CHUNKS_IN_FLIGHT, Math.ceil(size / CHUNK_BYTES))
  // Why allSettled: callers close their handles afterwards, so no chunk may still be pending.
  const results = await Promise.allSettled(Array.from({ length: workers }, worker))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }
}
