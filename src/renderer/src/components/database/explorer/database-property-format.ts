import { translate } from '@/i18n/i18n'
import type {
  DatabaseColumnProperties,
  DatabaseObjectProperties,
  DatabaseProperty
} from '../../../../../shared/database/database-properties-types'
import {
  columnFieldLabel,
  propertyLabel,
  propertySectionLabel,
  type ColumnField
} from './database-property-labels'

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB', 'PB']
const BYTES_PER_UNIT = 1024
const WHOLE_NUMBER = /^-?\d+$/
// A driver's UTC reading of a zone-less server time, e.g. tedious' `…T10:00:00.000Z`.
const ISO_UTC = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z$/

function grouped(value: string): string {
  return new Intl.NumberFormat().format(BigInt(value))
}

/** `1.2 MB (1,234,567 bytes)`: readable, with the exact count kept. */
export function formatBytes(value: string): string {
  if (!WHOLE_NUMBER.test(value)) {
    return value
  }
  const exact = translate('database.properties.bytes', '{{value0}} bytes', {
    value0: grouped(value)
  })
  let size = Number(value)
  let unit = -1
  while (Math.abs(size) >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    size /= BYTES_PER_UNIT
    unit += 1
  }
  if (unit < 0) {
    return exact
  }
  const rounded = size >= 100 ? Math.round(size) : Math.round(size * 10) / 10
  return `${rounded} ${BYTE_UNITS[unit]} (${exact})`
}

/** A property's value as the page shows it; the text as read when it has no special form. */
export function formatPropertyValue(property: DatabaseProperty): string {
  switch (property.format) {
    case 'bytes':
      return formatBytes(property.value)
    case 'count':
      return WHOLE_NUMBER.test(property.value) ? grouped(property.value) : property.value
    case 'boolean':
      return property.value === 'true'
        ? translate('database.properties.yes', 'Yes')
        : translate('database.properties.no', 'No')
    case 'datetime': {
      const iso = ISO_UTC.exec(property.value)
      return iso ? `${iso[1]} ${iso[2]}` : property.value
    }
    case 'text':
      return property.value
  }
}

const ALWAYS_SHOWN: readonly ColumnField[] = ['name', 'dataType', 'nullable']
const SOMETIMES_SHOWN: readonly ColumnField[] = [
  'defaultValue',
  'characterSet',
  'collation',
  'comment'
]

/** The column fields worth a column: those some column has a value for. */
export function shownColumnFields(columns: readonly DatabaseColumnProperties[]): ColumnField[] {
  return [
    ...ALWAYS_SHOWN,
    ...SOMETIMES_SHOWN.filter((field) => columns.some((column) => column[field] !== null))
  ]
}

export function columnFieldText(column: DatabaseColumnProperties, field: ColumnField): string {
  const value = column[field]
  if (typeof value === 'boolean') {
    return value
      ? translate('database.properties.yes', 'Yes')
      : translate('database.properties.no', 'No')
  }
  return value ?? ''
}

/** Everything the dialog shows, as text to paste: sections, then columns as TSV, then notes. */
export function propertiesAsText(properties: DatabaseObjectProperties): string {
  const sections = properties.sections.map((section) =>
    [
      [propertySectionLabel(section.kind), section.name].filter(Boolean).join(' '),
      ...section.properties.map(
        (property) => `${propertyLabel(property.key)}: ${formatPropertyValue(property)}`
      )
    ].join('\n')
  )
  const fields = properties.columns ? shownColumnFields(properties.columns) : []
  const columns = properties.columns
    ? [
        fields.map(columnFieldLabel).join('\t'),
        ...properties.columns.map((column) =>
          fields.map((field) => columnFieldText(column, field)).join('\t')
        )
      ].join('\n')
    : null
  const notes = properties.notes.length > 0 ? properties.notes.join('\n') : null
  return [...sections, columns, notes].filter((part) => part !== null).join('\n\n')
}
