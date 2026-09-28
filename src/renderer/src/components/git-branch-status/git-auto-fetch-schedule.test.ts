import { describe, expect, it } from 'vitest'
import { isGitAutoFetchDue, normalizeGitAutoFetchIntervalMinutes } from './git-auto-fetch-schedule'

const MINUTE = 60_000

describe('normalizeGitAutoFetchIntervalMinutes', () => {
  it('snaps stored values to an offered interval', () => {
    expect(normalizeGitAutoFetchIntervalMinutes(15)).toBe(15)
    expect(normalizeGitAutoFetchIntervalMinutes(1)).toBe(5)
    expect(normalizeGitAutoFetchIntervalMinutes(40)).toBe(30)
    expect(normalizeGitAutoFetchIntervalMinutes(600)).toBe(60)
    expect(normalizeGitAutoFetchIntervalMinutes(undefined)).toBe(15)
    expect(normalizeGitAutoFetchIntervalMinutes(Number.NaN)).toBe(15)
  })
})

describe('isGitAutoFetchDue', () => {
  const base = { intervalMs: 15 * MINUTE, enabledAt: 0, startupDelayMs: MINUTE }

  it('waits out the startup delay for a repository not yet fetched', () => {
    expect(isGitAutoFetchDue({ ...base, now: 30_000, lastAttemptAt: undefined })).toBe(false)
    expect(isGitAutoFetchDue({ ...base, now: MINUTE, lastAttemptAt: undefined })).toBe(true)
  })

  it('fetches again once a full interval has passed since the last attempt', () => {
    expect(isGitAutoFetchDue({ ...base, now: 20 * MINUTE, lastAttemptAt: 6 * MINUTE })).toBe(false)
    expect(isGitAutoFetchDue({ ...base, now: 21 * MINUTE, lastAttemptAt: 6 * MINUTE })).toBe(true)
  })
})
