import {
  Binary,
  BSON,
  BSONRegExp,
  BSONSymbol,
  Code,
  DBRef,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  type Document
} from 'mongodb'
import type { DatabaseCell, DatabaseColumn } from '../../../shared/database/database-query-types'

/** More fields than this in one page go into one JSON column, so a map-like document can't widen the grid without end. */
export const MONGO_MAX_COLUMNS = 200
export const MORE_FIELDS_COLUMN = '(more fields)'

// Why instanceof: the driver decodes with the bson copy that 'mongodb' re-exports.
const BSON_TYPE_NAMES: readonly [abstract new (...args: never[]) => object, string][] = [
  [ObjectId, 'objectId'],
  [Long, 'long'],
  [Int32, 'int'],
  [Double, 'double'],
  [Decimal128, 'decimal'],
  [Binary, 'binData'],
  [Timestamp, 'timestamp'],
  [BSONRegExp, 'regex'],
  [RegExp, 'regex'],
  [Date, 'date'],
  [MinKey, 'minKey'],
  [MaxKey, 'maxKey'],
  [Code, 'javascript'],
  [DBRef, 'dbPointer'],
  [BSONSymbol, 'symbol']
]

/** The BSON type name mongosh's $type uses, for a column header. */
export function mongoTypeName(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'string') {
    return 'string'
  }
  if (typeof value === 'boolean') {
    return 'bool'
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'double'
  }
  if (typeof value === 'bigint') {
    return 'long'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return BSON_TYPE_NAMES.find(([type]) => value instanceof type)?.[1] ?? 'object'
}

function binaryText(value: Binary): string {
  if (value.sub_type === Binary.SUBTYPE_UUID) {
    try {
      return value.toUUID().toHexString()
    } catch {
      // Falls through to the bytes: a subtype-4 value need not be 16 bytes long.
    }
  }
  return `0x${Buffer.from(value.buffer).toString('hex')}`
}

/** A BSON scalar as mongosh would print its value; null for documents and arrays. */
function bsonScalarText(value: unknown): string | null {
  if (
    value instanceof ObjectId ||
    value instanceof Long ||
    value instanceof Int32 ||
    value instanceof Double ||
    value instanceof Decimal128
  ) {
    return String(value)
  }
  if (value instanceof Binary) {
    return binaryText(value)
  }
  if (value instanceof Timestamp) {
    return `Timestamp(${value.t}, ${value.i})`
  }
  if (value instanceof BSONRegExp) {
    return `/${value.pattern}/${value.options}`
  }
  if (value instanceof MinKey || value instanceof MaxKey) {
    return value instanceof MinKey ? 'MinKey' : 'MaxKey'
  }
  return value instanceof Code ? value.code : null
}

/** A value as grid text; documents and arrays become relaxed Extended JSON. */
export function mongoCellText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  }
  if (value instanceof RegExp) {
    return String(value)
  }
  return bsonScalarText(value) ?? BSON.EJSON.stringify(value, { relaxed: true })
}

/**
 * The grid's columns for a page of documents: every field in order of first appearance,
 * `_id` first, typed by the values seen (`mixed` when they differ).
 */
export function documentColumns(documents: readonly Document[]): DatabaseColumn[] {
  const types = new Map<string, string>()
  for (const document of documents) {
    for (const [field, value] of Object.entries(document)) {
      const type = mongoTypeName(value)
      const seen = types.get(field)
      if (seen === undefined || seen === 'null') {
        types.set(field, type)
      } else if (type !== 'null' && seen !== type) {
        types.set(field, 'mixed')
      }
    }
  }
  const fields = [...types.keys()].sort((left, right) =>
    left === '_id' ? -1 : right === '_id' ? 1 : 0
  )
  const shown = fields.slice(0, MONGO_MAX_COLUMNS)
  const columns = shown.map((name) => ({ name, typeName: types.get(name) ?? 'mixed' }))
  return fields.length > shown.length
    ? [...columns, { name: MORE_FIELDS_COLUMN, typeName: 'object' }]
    : columns
}

/** One document as a grid row under `columns`; fields the columns don't name go to "(more fields)" when it is there. */
export function documentRow(
  document: Document,
  columns: readonly DatabaseColumn[]
): DatabaseCell[] {
  const hasMore = columns.at(-1)?.name === MORE_FIELDS_COLUMN
  const named = hasMore ? columns.slice(0, -1) : columns
  const cells: DatabaseCell[] = named.map((column) =>
    Object.hasOwn(document, column.name) ? mongoCellText(document[column.name]) : null
  )
  if (!hasMore) {
    return cells
  }
  const names = new Set(named.map((column) => column.name))
  const rest = Object.fromEntries(Object.entries(document).filter(([field]) => !names.has(field)))
  return [...cells, Object.keys(rest).length > 0 ? mongoCellText(rest) : null]
}

/** A single document (a command's reply, stats) as `field`/`value` rows. */
export function documentFieldRows(document: Document): DatabaseCell[][] {
  return Object.entries(document).map(([field, value]) => [field, mongoCellText(value)])
}
