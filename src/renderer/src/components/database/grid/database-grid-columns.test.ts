import { describe, expect, it } from 'vitest'
import {
  GRID_FIT_MAX_COLUMN_PX,
  GRID_MAX_COLUMN_PX,
  GRID_MIN_COLUMN_PX,
  fitGridColumn,
  gridCellDisplayText,
  gridHeaderTitle,
  isNumericColumnType,
  measureGridColumns,
  scrollLeftToReveal
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

  it('fits a column past the first-guess cap, up to the fit maximum', () => {
    const column = { name: 'body', typeName: 'text' }
    expect(fitGridColumn(column, [['x'.repeat(60)]], 0)).toBeGreaterThan(GRID_MAX_COLUMN_PX)
    expect(fitGridColumn(column, [['x'.repeat(5000)]], 0)).toBe(GRID_FIT_MAX_COLUMN_PX)
    expect(fitGridColumn(column, [[null]], 0)).toBe(GRID_MIN_COLUMN_PX)
  })

  it('measures the displayed single-line text with the given measure', () => {
    const tenPerChar = (text: string) => text.length * 10
    // 'a↵bcdef' is 7 characters, plus 24px of cell padding.
    expect(fitGridColumn({ name: 'x', typeName: 't' }, [['a\nbcdef']], 0, tenPerChar)).toBe(94)
  })

  it('scrolls just enough to reveal a column beside the sticky row numbers', () => {
    const widths = [100, 100, 100, 100]
    // Row numbers take 56px, so column 3 spans 356..456 in content coordinates.
    expect(scrollLeftToReveal(widths, 2, 0, 400)).toBe(0)
    expect(scrollLeftToReveal(widths, 3, 0, 400)).toBe(456 - 400)
    expect(scrollLeftToReveal(widths, 0, 150, 400)).toBe(0)
    expect(scrollLeftToReveal([100, 900], 1, 0, 400)).toBe(100)
  })
})

describe('gridHeaderTitle', () => {
  it('shows the column comment under its name, and only the name without one', () => {
    expect(gridHeaderTitle('name', 'Given and family name\nas written')).toBe(
      'name\nGiven and family name\nas written'
    )
    expect(gridHeaderTitle('id', undefined)).toBe('id')
    expect(gridHeaderTitle('id', '')).toBe('id')
  })
})
