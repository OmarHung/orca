import { describe, expect, it } from 'vitest'
import {
  DATABASE_PROPERTY_KEYS,
  type DatabaseProperty
} from '../../../../../shared/database/database-properties-types'
import { formatBytes, formatPropertyValue, propertiesAsText } from './database-property-format'
import { propertyLabel, propertySectionLabel } from './database-property-labels'

const shown = (value: string, format: DatabaseProperty['format']): string =>
  formatPropertyValue({ key: 'size', value, format })

describe('formatPropertyValue', () => {
  it('shows sizes readably and keeps the exact byte count', () => {
    expect(formatBytes('512')).toBe('512 bytes')
    expect(formatBytes('16384')).toBe('16 KB (16,384 bytes)')
    expect(formatBytes('1234567')).toBe('1.2 MB (1,234,567 bytes)')
    expect(formatBytes('734003200')).toBe('700 MB (734,003,200 bytes)')
    // Past 2^53 the count stays exact.
    expect(formatBytes('9007199254740993')).toBe('8 PB (9,007,199,254,740,993 bytes)')
    expect(formatBytes('about 3')).toBe('about 3')
  })

  it('groups counts, names flags and keeps other text as read', () => {
    expect(shown('1234567', 'count')).toBe('1,234,567')
    expect(shown('-1', 'count')).toBe('-1')
    expect(shown('true', 'boolean')).toBe('Yes')
    expect(shown('false', 'boolean')).toBe('No')
    expect(shown('utf8mb4_0900_ai_ci', 'text')).toBe('utf8mb4_0900_ai_ci')
  })

  it('shows a server time as the server wrote it, not as a UTC instant', () => {
    expect(shown('2026-09-28T10:04:05.123Z', 'datetime')).toBe('2026-09-28 10:04:05.123')
    expect(shown('2026-09-28 10:04:05', 'datetime')).toBe('2026-09-28 10:04:05')
  })
})

describe('property labels', () => {
  it('names every property and section in words, not by its key', () => {
    for (const key of DATABASE_PROPERTY_KEYS) {
      expect(propertyLabel(key), key).not.toBe(key)
      expect(propertyLabel(key), key).not.toBe('')
    }
    expect(propertySectionLabel('view')).toBe('View')
  })
})

describe('propertiesAsText', () => {
  it('writes sections, then the columns worth showing as TSV, then notes', () => {
    expect(
      propertiesAsText({
        sections: [
          {
            kind: 'table',
            name: 'people',
            properties: [
              { key: 'engine', value: 'InnoDB', format: 'text' },
              { key: 'rowsEstimate', value: '1200', format: 'count' }
            ]
          }
        ],
        columns: [
          {
            name: 'id',
            dataType: 'int',
            nullable: false,
            defaultValue: null,
            characterSet: null,
            collation: null,
            comment: null
          },
          {
            name: 'name',
            dataType: 'varchar(20)',
            nullable: true,
            defaultValue: null,
            characterSet: null,
            collation: 'latin1_german2_ci',
            comment: 'who'
          }
        ],
        notes: ["Couldn't read the sizes: permission denied"]
      })
    ).toBe(
      [
        'Table people',
        'Engine: InnoDB',
        'Rows (estimated): 1,200',
        '',
        'Name\tType\tNullable\tCollation\tComment',
        'id\tint\tNo\t\t',
        'name\tvarchar(20)\tYes\tlatin1_german2_ci\twho',
        '',
        "Couldn't read the sizes: permission denied"
      ].join('\n')
    )
  })
})
