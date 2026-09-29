import { afterEach, describe, expect, it, vi } from 'vitest'
import { SshVpnRendererRequests } from './ssh-vpn-renderer-requests'

type Request = { requestId: string; question: string }

afterEach(() => {
  vi.useRealTimers()
})

describe('SshVpnRendererRequests', () => {
  it('sends the request to the window and resolves with its answer', async () => {
    const sent: Request[] = []
    const requests = new SshVpnRendererRequests<Request, boolean>((request) => {
      sent.push(request)
      return true
    }, false)

    const answer = requests.ask((requestId) => ({ requestId, question: 'start?' }))
    expect(sent).toEqual([{ requestId: expect.any(String), question: 'start?' }])
    requests.answer(sent[0].requestId, true)

    await expect(answer).resolves.toBe(true)
  })

  it('falls back when there is no window, on timeout, and ignores unknown or late answers', async () => {
    vi.useFakeTimers()
    const noWindow = new SshVpnRendererRequests<Request, boolean>(() => false, false)
    await expect(noWindow.ask((requestId) => ({ requestId, question: 'q' }))).resolves.toBe(false)

    const sent: Request[] = []
    const requests = new SshVpnRendererRequests<Request, boolean>(
      (request) => {
        sent.push(request)
        return true
      },
      false,
      1_000
    )
    const answer = requests.ask((requestId) => ({ requestId, question: 'q' }))
    requests.answer('unknown', true)
    await vi.advanceTimersByTimeAsync(1_000)
    requests.answer(sent[0].requestId, true)

    await expect(answer).resolves.toBe(false)
  })
})
