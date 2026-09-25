import { describe, expect, it } from 'vitest'
import { compareReleaseTags, pickLatestReleaseTag } from './fork-source-release-tags'

const oid = 'a'.repeat(40)

describe('pickLatestReleaseTag', () => {
  it('picks the highest plain release tag by version, not by string order', () => {
    const output = [
      `${oid}\trefs/tags/v1.4.99`,
      `${oid}\trefs/tags/v1.4.211`,
      `${oid}\trefs/tags/v1.4.212-rc.1`,
      `${oid}\trefs/tags/v1.4.210`,
      `${oid}\trefs/tags/hourly-2026`
    ].join('\n')
    expect(pickLatestReleaseTag(output)).toBe('v1.4.211')
  })

  it('returns null when no release tag is listed', () => {
    expect(pickLatestReleaseTag(`${oid}\trefs/tags/v1.4.212-rc.1\n`)).toBeNull()
    expect(pickLatestReleaseTag('')).toBeNull()
  })
})

describe('compareReleaseTags', () => {
  it('orders numerically', () => {
    expect(compareReleaseTags('v1.4.212', 'v1.4.211')).toBeGreaterThan(0)
    expect(compareReleaseTags('v1.4.99', 'v1.4.211')).toBeLessThan(0)
    expect(compareReleaseTags('v1.4.211', 'v1.4.211')).toBe(0)
  })
})
