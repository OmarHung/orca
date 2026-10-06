import type { NgrokEndpoint, NgrokShareRequest } from '../../../../shared/ngrok/ngrok-types'

/** A live run or debug session whose saved configuration asks for ngrok. */
export type AutoShareSession = {
  /** The run-port owner key, e.g. `run:<session key>` or `debug:<session id>`. */
  ownerKey: string
  attemptId: string
  /** What to share now; null while the session has not opened its port yet. */
  target: NgrokShareRequest | null
}

export type NgrokEndpointRef = Pick<NgrokEndpoint, 'agentAddress' | 'name' | 'upstreamPort'>

export type AutoShareRecord = {
  attemptId: string
  /** The endpoint to stop when the session ends: one Orca's agent runs for it. */
  endpoint: NgrokEndpointRef | null
}

export type AutoSharePlan = {
  share: { ownerKey: string; attemptId: string; target: NgrokShareRequest }[]
  stop: NgrokEndpointRef[]
  records: Record<string, AutoShareRecord>
}

/**
 * One share per session attempt: once asked for, a failure or a manual stop is not retried until
 * a rerun. A port something already shares is adopted, so a renderer reload does not share again.
 */
export function planAutoShare(
  sessions: readonly AutoShareSession[],
  records: Readonly<Record<string, AutoShareRecord>>,
  existingEndpointFor: (port: number) => NgrokEndpoint | null
): AutoSharePlan {
  const live = new Map(sessions.map((session) => [session.ownerKey, session]))
  const plan: AutoSharePlan = { share: [], stop: [], records: {} }
  for (const [ownerKey, record] of Object.entries(records)) {
    const session = live.get(ownerKey)
    if (session?.attemptId === record.attemptId) {
      plan.records[ownerKey] = record
    } else if (record.endpoint) {
      plan.stop.push(record.endpoint)
    }
  }
  for (const session of sessions) {
    if (plan.records[session.ownerKey] || !session.target) {
      continue
    }
    const existing = existingEndpointFor(session.target.port)
    plan.records[session.ownerKey] = {
      attemptId: session.attemptId,
      // Why managed only: an endpoint someone started outside Orca is theirs to stop.
      endpoint:
        existing?.managed === true
          ? {
              agentAddress: existing.agentAddress,
              name: existing.name,
              upstreamPort: existing.upstreamPort
            }
          : null
    }
    if (!existing) {
      plan.share.push({
        ownerKey: session.ownerKey,
        attemptId: session.attemptId,
        target: session.target
      })
    }
  }
  return plan
}
