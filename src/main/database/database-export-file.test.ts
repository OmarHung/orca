import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {} }))

import { exportFileName } from './database-export-file'

describe('exportFileName', () => {
  it('replaces characters no platform allows and keeps the format extension', () => {
    expect(exportFileName('public/orders:2026', 'csv')).toBe('public_orders_2026.csv')
    expect(exportFileName('a\u0000b\tc', 'json')).toBe('a_b_c.json')
  })

  it('falls back to a default name and caps long names', () => {
    expect(exportFileName('   ', 'sql')).toBe('export.sql')
    expect(exportFileName('x'.repeat(300), 'tsv')).toBe(`${'x'.repeat(100)}.tsv`)
  })
})
