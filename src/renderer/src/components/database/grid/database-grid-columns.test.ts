import { describe, expect, it } from 'vitest'
import {
  GRID_MAX_COLUMN_PX,
  GRID_MIN_COLUMN_PX,
  gridCellDisplayText,
  isNumericColumnType,
  measureGridColumns
} from './database-grid-columns'

describe('database grid columns', () => {
  it('recognises numeric SQL types for right alignment', () => {
    for (const type of ['integer', 'bigint', 'numeric(30,10)', 'double precision', 'bigserial']) {
      expect(isNumericColumnType(type)).toBe(true)
    }
    for (const type of ['text', 'interval', 'point', 'character varying(20)']) {
      expect(isNumericColumnType(type)).toBe(false)
    }
  })

  it('clamps widths and considers header, type and sampled values', () => {
    const widths = measureGridColumns(
      [
        { name: 'id', typeName: 'int4' },
        { name: 'body', typeName: 'text' }
      ],
      [
        ['1', 'x'.repeat(500)],
        [null, { preview: 'y', length: 90_000 }]
      ]
    )
    expect(widths[0]).toBe(GRID_MIN_COLUMN_PX)
    expect(widths[1]).toBe(GRID_MAX_COLUMN_PX)
  })

  it('shows newlines as a visible marker and keeps NULL distinct from empty text', () => {
    expect(gridCellDisplayText('a\nb')).toBe('a↵b')
    expect(gridCellDisplayText(null)).toBeNull()
    expect(gridCellDisplayText('')).toBe('')
  })
})
