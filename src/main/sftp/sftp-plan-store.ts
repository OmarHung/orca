import { randomUUID } from 'node:crypto'
import type { SftpPlan } from '../../shared/sftp-types'

// Why: a plan describes the remote as it was; an old one may no longer match what is there.
const PLAN_TTL_MS = 10 * 60_000
const MAX_STORED_PLANS = 20

type StoredPlan = { plan: SftpPlan; expiresAt: number }

/** Confirmed actions run from here, never from what the renderer sends back. */
export class SftpPlanStore {
  private readonly plans = new Map<string, StoredPlan>()

  constructor(private readonly now: () => number = Date.now) {}

  save(draft: Omit<SftpPlan, 'planId'>): SftpPlan {
    this.prune()
    const plan: SftpPlan = { ...draft, planId: randomUUID() }
    this.plans.set(plan.planId, { plan, expiresAt: this.now() + PLAN_TTL_MS })
    return plan
  }

  /** Single use: a plan can run at most once. */
  take(planId: string): SftpPlan | null {
    const stored = this.plans.get(planId)
    this.plans.delete(planId)
    return stored && stored.expiresAt > this.now() ? stored.plan : null
  }

  discard(planId: string): void {
    this.plans.delete(planId)
  }

  private prune(): void {
    const now = this.now()
    for (const [planId, stored] of this.plans) {
      if (stored.expiresAt <= now) {
        this.plans.delete(planId)
      }
    }
    // Map iteration is insertion order, so this drops the oldest unanswered plans.
    for (const planId of this.plans.keys()) {
      if (this.plans.size < MAX_STORED_PLANS) {
        break
      }
      this.plans.delete(planId)
    }
  }
}
