import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.mock('electron', () => ({ net: { fetch: (...args: unknown[]) => fetchMock(...args) } }))

const { downloadWithElectronNet } = await import('./adapter-download')

const MIB = 1024 * 1024
const URL = 'https://example.test/adapter.zip'

/** A body of `chunks` 1 MiB chunks, counting how many were pulled and whether it was cancelled. */
function chunkedBody(chunks: number): {
  body: ReadableStream<Uint8Array>
  pulled: () => number
  cancelled: () => boolean
} {
  let pulled = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunks) {
        controller.close()
        return
      }
      pulled += 1
      controller.enqueue(new Uint8Array(MIB))
    },
    cancel() {
      cancelled = true
    }
  })
  return { body, pulled: () => pulled, cancelled: () => cancelled }
}

describe('downloadWithElectronNet', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('returns the body when it fits', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))

    await expect(downloadWithElectronNet(URL)).resolves.toEqual(Buffer.from([1, 2, 3]))
  })

  it('rejects a declared oversized body without reading it', async () => {
    const stream = chunkedBody(1)
    fetchMock.mockResolvedValue(
      new Response(stream.body, { headers: { 'content-length': String(65 * MIB) } })
    )

    await expect(downloadWithElectronNet(URL)).rejects.toThrow(`Download exceeded ${64 * MIB}`)
    expect(stream.pulled()).toBeLessThanOrEqual(1)
  })

  it('stops reading an undeclared body once it passes the limit', async () => {
    const stream = chunkedBody(200)
    fetchMock.mockResolvedValue(new Response(stream.body))

    await expect(downloadWithElectronNet(URL)).rejects.toThrow(`Download exceeded ${64 * MIB}`)
    expect(stream.cancelled()).toBe(true)
    expect(stream.pulled()).toBeLessThan(70)
  })

  it('reports HTTP failures', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }))

    await expect(downloadWithElectronNet(URL)).rejects.toThrow('HTTP 404')
  })
})
