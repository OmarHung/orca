import { describe, expect, it } from 'vitest'
import { cellLockReason, tableLockReason } from './table-edit-locks'

describe('table edit locks', () => {
  it('allows editing only a writable table whose primary key is in the result', () => {
    const ready = { status: 'ready' as const, keyColumns: ['id'] }
    expect(tableLockReason(false, ready, ['id', 'name'])).toBeNull()
    expect(tableLockReason(true, ready, ['id'])).toMatch(/read-only/)
    expect(tableLockReason(false, { status: 'loading' }, ['id'])).toMatch(/Loading/)
    expect(tableLockReason(false, { status: 'ready', keyColumns: [] }, ['id'])).toMatch(
      /no primary key/
    )
    expect(tableLockReason(false, ready, ['name'])).toMatch(/doesn’t include/)
  })

  it('keeps deleted rows, binary columns and truncated values out of the editor', () => {
    expect(cellLockReason(null, 'text', 'Ada')).toBeNull()
    expect(
      cellLockReason({ kind: 'deleted', modified: new Set(), unset: new Set() }, 'text', 'Ada')
    ).toMatch(/deleted/)
    expect(cellLockReason(null, 'bytea', '\\x00')).toMatch(/Binary/)
    expect(cellLockReason(null, 'VARBINARY(16)', '0x00')).toMatch(/Binary/)
    expect(cellLockReason(null, 'text', { preview: 'abc', length: 90_000 })).toMatch(/start/)
  })
})
