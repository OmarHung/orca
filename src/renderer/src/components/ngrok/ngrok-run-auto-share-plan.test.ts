import { describe, expect, it } from 'vitest'
import type { NgrokEndpoint } from '../../../../shared/ngrok/ngrok-types'
import { planAutoShare, type AutoShareSession } from './ngrok-run-auto-share-plan'

const target = { port: 5016, protocol: 'http', host: 'localhost' } as const

function session(overrides: Partial<AutoShareSession> = {}): AutoShareSession {
  return { ownerKey: 'run:a', attemptId: 'attempt-1', target, ...overrides }
}

const managedEndpoint: NgrokEndpoint = {
  agentAddress: '127.0.0.1:4041',
  managed: true,
  name: 'orca-5016',
  publicUrl: 'https://abc.ngrok-free.app',
  upstream: 'http://localhost:5016',
  upstreamPort: 5016
}

const noEndpoint = (): null => null

describe('planAutoShare', () => {
  it('waits for the port, then shares it once per attempt', () => {
    const waiting = planAutoShare([session({ target: null })], {}, noEndpoint)
    expect(waiting).toEqual({ share: [], stop: [], records: {} })

    const first = planAutoShare([session()], {}, noEndpoint)
    expect(first.share).toEqual([{ ownerKey: 'run:a', attemptId: 'attempt-1', target }])

    // A failed share, or one the user stopped, is not retried in the same attempt.
    const again = planAutoShare([session()], first.records, noEndpoint)
    expect(again.share).toEqual([])
  })

  it('shares again on a rerun and stops what the old attempt shared', () => {
    const records = {
      'run:a': {
        attemptId: 'attempt-1',
        endpoint: { agentAddress: '127.0.0.1:4041', name: 'orca-5016', upstreamPort: 5016 }
      }
    }
    const plan = planAutoShare([session({ attemptId: 'attempt-2' })], records, noEndpoint)
    expect(plan.stop).toEqual([records['run:a'].endpoint])
    expect(plan.share).toEqual([{ ownerKey: 'run:a', attemptId: 'attempt-2', target }])
  })

  it('stops the endpoint when the session ends', () => {
    const records = {
      'run:a': { attemptId: 'attempt-1', endpoint: { ...managedEndpoint } }
    }
    const plan = planAutoShare([], records, noEndpoint)
    expect(plan.stop).toEqual([managedEndpoint])
    expect(plan.records).toEqual({})
  })

  it("adopts a port that is already shared, but never takes over someone else's endpoint", () => {
    const adopted = planAutoShare([session()], {}, () => managedEndpoint)
    expect(adopted.share).toEqual([])
    expect(adopted.records['run:a'].endpoint).toEqual({
      agentAddress: '127.0.0.1:4041',
      name: 'orca-5016',
      upstreamPort: 5016
    })

    const external = planAutoShare([session()], {}, () => ({ ...managedEndpoint, managed: false }))
    expect(external.share).toEqual([])
    expect(external.records['run:a'].endpoint).toBeNull()
    expect(planAutoShare([], external.records, noEndpoint).stop).toEqual([])
  })
})
