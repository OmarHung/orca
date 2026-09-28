import type {
  DatabaseProperty,
  DatabasePropertyFormat,
  DatabasePropertyKey
} from '../../../shared/database/database-properties-types'

/** A catalog value as text; null when the server has nothing to report. */
export function propertyText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  const text = String(value)
  return text.trim() === '' ? null : text
}

/** A catalog flag in any driver's spelling (true, 1, 'YES', 't'); null when absent. */
export function propertyFlag(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'boolean') {
    return value
  }
  const text = String(value).trim().toLowerCase()
  if (['1', 'yes', 'true', 't', 'on'].includes(text)) {
    return true
  }
  return ['0', 'no', 'false', 'f', 'off'].includes(text) ? false : null
}

/** The property, or nothing when the value is absent: spread the result into a list. */
export function property(
  key: DatabasePropertyKey,
  value: unknown,
  format: DatabasePropertyFormat = 'text'
): DatabaseProperty[] {
  const text = format === 'boolean' ? propertyText(propertyFlag(value)) : propertyText(value)
  return text === null ? [] : [{ key, value: text, format }]
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One read that may fail on its own (a missing permission, an older server): its failure
 * becomes a note, and the rest of the properties still show.
 */
export async function optionalRead<T>(
  notes: string[],
  what: string,
  read: () => Promise<T>
): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    notes.push(`Couldn't read the ${what}: ${failureMessage(error)}`)
    return null
  }
}

export function optionalReadSync<T>(notes: string[], what: string, read: () => T): T | null {
  try {
    return read()
  } catch (error) {
    notes.push(`Couldn't read the ${what}: ${failureMessage(error)}`)
    return null
  }
}
