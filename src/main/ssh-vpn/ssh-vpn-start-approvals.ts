import { randomUUID } from 'node:crypto'
import type { SshVpnStartConfirmRequest } from '../../shared/ssh-vpn-types'
import type { SshVpnStartApproval } from './ssh-vpn-service'

// Why a bound: a request nobody answers (window closed mid-dialog) must not hold the start forever.
const APPROVAL_TIMEOUT_MS = 5 * 60_000

/**
 * Starts that wait for the user. Main sends each request to the renderer, which shows the
 * commands and answers; no window, a timeout or a closed dialog all mean "do not start".
 */
export class SshVpnStartApprovals {
  private readonly pending = new Map<string, (approved: boolean) => void>()

  constructor(
    /** Delivers the request to a window; false when there is none to ask. */
    private readonly send: (request: SshVpnStartConfirmRequest) => boolean,
    private readonly timeoutMs = APPROVAL_TIMEOUT_MS
  ) {}

  readonly approve: SshVpnStartApproval = ({ profile, hostLabel, commands }) => {
    const requestId = randomUUID()
    return new Promise<boolean>((resolve) => {
      const settle = (approved: boolean): void => {
        if (this.pending.delete(requestId)) {
          clearTimeout(timer)
          resolve(approved)
        }
      }
      const timer = setTimeout(() => settle(false), this.timeoutMs)
      this.pending.set(requestId, settle)
      if (!this.send({ requestId, profileName: profile.name, hostLabel, commands })) {
        settle(false)
      }
    })
  }

  answer(requestId: string, approved: boolean): void {
    this.pending.get(requestId)?.(approved)
  }
}
