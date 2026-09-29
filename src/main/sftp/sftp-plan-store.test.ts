import { describe, expect, it } from 'vitest'
import { SftpPlanStore } from './sftp-plan-store'

const draft = {
  kind: 'mkdir' as const,
  targetId: 'web',
  operations: [{ op: 'mkdir' as const, path: '/srv/new', keepExisting: false }],
  totalBytes: 0,
  conflicts: []
}

describe('SftpPlanStore', () => {
  it('hands a plan out once', () => {
    const store = new SftpPlanStore()
    const plan = store.save(draft)

    expect(store.take(plan.planId)).toEqual(plan)
    expect(store.take(plan.planId)).toBeNull()
  })

  it('refuses a plan after ten minutes', () => {
    let now = 0
    const store = new SftpPlanStore(() => now)
    const plan = store.save(draft)

    now = 10 * 60_000
    expect(store.take(plan.planId)).toBeNull()
  })

  it('drops the oldest unanswered plans beyond twenty', () => {
    const store = new SftpPlanStore()
    const first = store.save(draft)
    for (let index = 0; index < 20; index += 1) {
      store.save(draft)
    }

    expect(store.take(first.planId)).toBeNull()
  })
})
