import { describe, expect, it } from 'vitest'
import {
  branchCompareTarget,
  commitCompareTarget,
  isSameCompareTarget,
  orderCommitPair
} from './git-log-compare-target'

describe('orderCommitPair', () => {
  it('uses the older commit (lower in the newest-first log) as the base', () => {
    const logOrder = ['newest', 'middle', 'oldest']
    expect(orderCommitPair(['newest', 'oldest'], logOrder)).toEqual({
      base: 'oldest',
      target: 'newest'
    })
    expect(orderCommitPair(['oldest', 'middle'], logOrder)).toEqual({
      base: 'oldest',
      target: 'middle'
    })
  })
})

describe('compare targets', () => {
  it('labels commits by short hash and branches by name', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    expect(commitCompareTarget({ id: sha })).toEqual({ oid: sha, label: '0123456' })
    expect(branchCompareTarget({ revision: sha, name: 'origin/main' })).toEqual({
      oid: sha,
      label: 'origin/main'
    })
  })

  it('treats the same object id as the same side regardless of case', () => {
    expect(isSameCompareTarget({ oid: 'ABC', label: 'x' }, { oid: 'abc', label: 'y' })).toBe(true)
  })
})
