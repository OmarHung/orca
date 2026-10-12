import { describe, expect, it } from 'vitest'
import { getDirectWorkItemWorkspaceNames } from './launch-work-item-direct-draft'

describe('getDirectWorkItemWorkspaceNames', () => {
  it('seeds a numberless item from its workspaceName', () => {
    const item = {
      type: 'issue' as const,
      number: null,
      title: 'T',
      url: 'u',
      workspaceName: 'monday-2'
    }

    expect(getDirectWorkItemWorkspaceNames(item, 'issue', null).workspaceName).toBe('monday-2')
  })
})
