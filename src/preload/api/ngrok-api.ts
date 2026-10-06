import type {
  NgrokEndpoint,
  NgrokResult,
  NgrokShareRequest,
  NgrokSnapshot,
  NgrokStopRequest
} from '../../shared/ngrok/ngrok-types'

export type NgrokApi = {
  /** Orca's agent plus the agents behind `agentPorts`, listeners whose process is ngrok. */
  snapshot: (agentPorts: number[]) => Promise<NgrokResult<NgrokSnapshot>>
  /** Shares a local port publicly, starting Orca's agent first when needed. */
  share: (request: NgrokShareRequest) => Promise<NgrokResult<NgrokEndpoint>>
  /** Brings up an endpoint ngrok.yml defines, like `ngrok start <name>`. */
  startConfigured: (name: string) => Promise<NgrokResult<NgrokEndpoint>>
  stopEndpoint: (request: NgrokStopRequest) => Promise<NgrokResult<void>>
  stopAgent: () => Promise<NgrokResult<void>>
  /** Orca's agent or its endpoints changed. */
  onChanged: (callback: () => void) => () => void
}
