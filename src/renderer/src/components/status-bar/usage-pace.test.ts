import { describe, expect, it } from 'vitest'
import { getUsagePacePercent, getUsageSeverity, getUsageWindowSeverity } from './usage-pace'

const HOUR = 60 * 60_000
const NOW = 1_800_000_000_000

describe('getUsagePacePercent', () => {
  it('returns the elapsed share of the window', () => {
    // 5h window resetting in 1h → 80% elapsed
    expect(getUsagePacePercent({ windowMinutes: 300, resetsAt: NOW + HOUR }, NOW)).toBe(80)
  })

  it('returns null when reset time or window length is unknown', () => {
    expect(getUsagePacePercent({ windowMinutes: 300, resetsAt: null }, NOW)).toBeNull()
    expect(getUsagePacePercent({ windowMinutes: 0, resetsAt: NOW + HOUR }, NOW)).toBeNull()
  })

  it('returns null when the reset falls outside the window', () => {
    expect(getUsagePacePercent({ windowMinutes: 300, resetsAt: NOW - HOUR }, NOW)).toBeNull()
    expect(getUsagePacePercent({ windowMinutes: 300, resetsAt: NOW + 6 * HOUR }, NOW)).toBeNull()
  })
})

describe('getUsageSeverity', () => {
  it('stays normal when usage is behind pace', () => {
    expect(getUsageSeverity(7, 74)).toBe('normal')
    expect(getUsageSeverity(48, 97)).toBe('normal')
  })

  it('warns when usage runs ahead of pace', () => {
    expect(getUsageSeverity(40, 20)).toBe('warning')
  })

  it('tolerates small overshoot and early-window noise', () => {
    expect(getUsageSeverity(24, 20)).toBe('normal')
    expect(getUsageSeverity(8, 2)).toBe('normal')
  })

  it('is critical when ahead of pace with most of the limit used', () => {
    expect(getUsageSeverity(75, 50)).toBe('critical')
  })

  it('falls back to absolute thresholds without a pace', () => {
    expect(getUsageSeverity(74, null)).toBe('normal')
    expect(getUsageSeverity(75, null)).toBe('warning')
    expect(getUsageSeverity(90, null)).toBe('critical')
  })

  it('is critical near the cap even when behind pace', () => {
    expect(getUsageSeverity(92, 99)).toBe('critical')
  })
})

describe('getUsageWindowSeverity', () => {
  it('derives pace from the window reset time', () => {
    const window = {
      usedPercent: 60,
      windowMinutes: 300,
      resetsAt: NOW + 4 * HOUR,
      resetDescription: null
    }
    expect(getUsageWindowSeverity(window, NOW)).toBe('warning')
  })
})
