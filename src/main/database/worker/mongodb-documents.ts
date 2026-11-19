import type { Document } from 'mongodb'

/** A plain document: an object that is not an array, a date, a regex or a BSON value. */
export function isDocument(value: unknown): value is Document {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp) &&
    !('_bsontype' in value)
  )
}

/** `value` when it is a document, else an empty one; server replies are checked, not trusted. */
export function documentOr(value: unknown): Document {
  return isDocument(value) ? value : {}
}

export function documentOrNull(value: unknown): Document | null {
  return isDocument(value) ? value : null
}

/** The documents in an array reply; anything else in it is left out. */
export function documentsIn(value: unknown): Document[] {
  return Array.isArray(value) ? value.filter(isDocument) : []
}
