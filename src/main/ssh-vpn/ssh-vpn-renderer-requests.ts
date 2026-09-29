import { randomUUID } from 'node:crypto'

// Why a bound: a request nobody answers (window closed mid-dialog) must not hold a start forever.
const REQUEST_TIMEOUT_MS = 5 * 60_000

/**
 * Questions main asks the user through the renderer (start approval, VPN login). No window, a
 * timeout or a dismissed dialog all resolve with `fallback`, which must mean "do not proceed".
 */
export class SshVpnRendererRequests<TRequest extends { requestId: string }, TAnswer> {
  private readonly pending = new Map<string, (answer: TAnswer) => void>()

  constructor(
    /** Delivers the request to a window; false when there is none to ask. */
    private readonly send: (request: TRequest) => boolean,
    private readonly fallback: TAnswer,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS
  ) {}

  ask(build: (requestId: string) => TRequest): Promise<TAnswer> {
    const requestId = randomUUID()
    return new Promise<TAnswer>((resolve) => {
      const settle = (answer: TAnswer): void => {
        if (this.pending.delete(requestId)) {
          clearTimeout(timer)
          resolve(answer)
        }
      }
      const timer = setTimeout(() => settle(this.fallback), this.timeoutMs)
      this.pending.set(requestId, settle)
      if (!this.send(build(requestId))) {
        settle(this.fallback)
      }
    })
  }

  answer(requestId: string, answer: TAnswer): void {
    this.pending.get(requestId)?.(answer)
  }
}
