import { describe, expect, it } from 'vitest'
import { isBrowserInternalChromiumPartition } from './browser-cookie-source-partition'

const MODERN_COLUMNS = new Set([
  'host_key',
  'name',
  'top_frame_site_key',
  'has_cross_site_ancestor'
])

describe('isBrowserInternalChromiumPartition', () => {
  it.each(['chrome-extension://gppongmhjkpfnbhagpmjfkannfbllamg', 'chrome://whats-new'])(
    'recognizes %s as a browser-internal partition',
    (site) => {
      expect(isBrowserInternalChromiumPartition({ top_frame_site_key: site }, MODERN_COLUMNS)).toBe(
        true
      )
    }
  )

  it.each(['https://top.example', '', 'not a url', 'https://top.example/not-a-site'])(
    'leaves %j to the partition reader',
    (site) => {
      expect(isBrowserInternalChromiumPartition({ top_frame_site_key: site }, MODERN_COLUMNS)).toBe(
        false
      )
    }
  )

  it('ignores a schema without the partition column', () => {
    expect(
      isBrowserInternalChromiumPartition(
        { top_frame_site_key: 'chrome://whats-new' },
        new Set(['host_key', 'name'])
      )
    ).toBe(false)
  })
})
