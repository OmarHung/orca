import { describe, expect, it } from 'vitest'
import type { GitHistoryItemRef, GitHistoryRefCategory } from '../../../../../shared/git-history'
import { dedupeRemoteTrackingRefs } from '../../../../../shared/git-history-ref-display'
import { collectFoldedRemoteRefs } from './git-log-ref-sync'

const ref = (id: string, name: string, category: GitHistoryRefCategory): GitHistoryItemRef => ({
  id,
  name,
  category
})

describe('collectFoldedRemoteRefs', () => {
  it('names the remote-tracking branch folded into a local badge', () => {
    const all = [
      ref('refs/heads/feature', 'feature', 'branches'),
      ref('refs/remotes/origin/feature', 'origin/feature', 'remote branches'),
      ref('refs/heads/main', 'main', 'branches')
    ]
    const shown = dedupeRemoteTrackingRefs(all)

    expect([...collectFoldedRemoteRefs(all, shown)]).toEqual([
      ['refs/heads/feature', 'origin/feature']
    ])
  })

  it('marks nothing when the remote branch is shown on its own', () => {
    const all = [ref('refs/remotes/origin/feature', 'origin/feature', 'remote branches')]
    expect(collectFoldedRemoteRefs(all, dedupeRemoteTrackingRefs(all)).size).toBe(0)
  })
})
