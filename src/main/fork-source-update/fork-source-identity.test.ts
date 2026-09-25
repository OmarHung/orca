import { describe, expect, it } from 'vitest'
import { parseForkSourceIdentity } from './fork-source-identity'

const identity = {
  repoRoot: '/Users/me/orca',
  branch: 'omar/custom',
  baseTag: 'v1.4.211',
  upstreamRemote: 'origin',
  forkRemote: 'fork'
}

describe('parseForkSourceIdentity', () => {
  it('reads the stamped fork identity', () => {
    expect(parseForkSourceIdentity({ name: 'orca', orcaForkSource: identity })).toEqual(identity)
  })

  it('treats official builds (no stamp) as not fork builds', () => {
    expect(parseForkSourceIdentity({ name: 'orca', version: '1.4.211' })).toBeNull()
    expect(parseForkSourceIdentity(null)).toBeNull()
  })

  it('rejects a relative repo path or a non-release base tag', () => {
    expect(
      parseForkSourceIdentity({ orcaForkSource: { ...identity, repoRoot: 'orca' } })
    ).toBeNull()
    expect(
      parseForkSourceIdentity({ orcaForkSource: { ...identity, baseTag: 'v1.4.211-rc.1' } })
    ).toBeNull()
  })
})
