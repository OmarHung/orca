import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createRepoUpdateSchema } from './repo-update-params'

describe('repo.update initialTab', () => {
  const schema = createRepoUpdateSchema({ repo: z.string() })

  it('keeps a terminal or agent choice', () => {
    for (const initialTab of ['terminal', 'claude', 'codex']) {
      expect(schema.parse({ repo: 'repo-1', updates: { initialTab } }).updates.initialTab).toBe(
        initialTab
      )
    }
  })

  it('drops an unknown choice instead of rejecting the update', () => {
    const parsed = schema.parse({
      repo: 'repo-1',
      updates: { initialTab: 'browser', displayName: 'renamed' }
    })

    expect(parsed.updates.initialTab).toBeUndefined()
    expect(parsed.updates.displayName).toBe('renamed')
  })
})
