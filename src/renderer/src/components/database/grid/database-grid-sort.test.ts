import { describe, expect, it } from 'vitest'
import { nextGridSort, sortedRowOrder } from './database-grid-sort'

describe('grid sort', () => {
  it('cycles ascending, descending, then off, and restarts on another column', () => {
    const asc = nextGridSort(null, 1)
    expect(asc).toEqual({ column: 1, direction: 'asc' })
    const desc = nextGridSort(asc, 1)
    expect(desc).toEqual({ column: 1, direction: 'desc' })
    expect(nextGridSort(desc, 1)).toBeNull()
    expect(nextGridSort(desc, 2)).toEqual({ column: 2, direction: 'asc' })
  })

  it('compares numeric columns as numbers and keeps NULLs last when ascending', () => {
    const rows = [['10'], [null], ['9'], ['-1.5']]
    expect(sortedRowOrder(rows, { column: 0, direction: 'asc' }, [true])).toEqual([3, 2, 0, 1])
    expect(sortedRowOrder(rows, { column: 0, direction: 'desc' }, [true])).toEqual([1, 0, 2, 3])
  })

  it('compares text naturally and keeps equal rows in their original order', () => {
    const rows = [['b'], ['a10'], ['a2'], ['b']]
    expect(sortedRowOrder(rows, { column: 0, direction: 'asc' }, [false])).toEqual([2, 1, 0, 3])
  })

  it('keeps the original order without a sort', () => {
    expect(sortedRowOrder([['b'], ['a']], null, [false])).toEqual([0, 1])
  })
})
