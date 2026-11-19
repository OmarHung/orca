import type { Node } from 'acorn'
import type { CollationOptions, Document } from 'mongodb'
import { isDocument } from './mongodb-documents'
import { EXPLAIN_VERBOSITIES, type MongoExplainVerbosity } from './mongodb-operation-types'
import { MongoShellSyntaxError, shellValue, type ShellNode } from './mongodb-shell-values'

/** Reads a method's arguments as the kind of value the method takes. */

export function documentArgument(
  node: ShellNode | undefined,
  what: string,
  fallback: Document = {}
): Document {
  if (!node) {
    return fallback
  }
  const value = shellValue(node)
  if (value === null || value === undefined) {
    return fallback
  }
  if (!isDocument(value)) {
    throw new MongoShellSyntaxError(`${what} takes a document, e.g. { name: "Ada" }.`, node)
  }
  return value
}

/** collation()'s document, which the server requires to name a locale. */
export function collationArgument(node: ShellNode | undefined, at: Node): CollationOptions {
  const value = documentArgument(node, 'collation()')
  const { locale } = value
  if (typeof locale !== 'string') {
    throw new MongoShellSyntaxError(
      'collation() takes a locale, e.g. { locale: "en" }.',
      node ?? at
    )
  }
  return { ...value, locale }
}

export function stringArgument(node: ShellNode | undefined, what: string, at: Node): string {
  const value = node ? shellValue(node) : undefined
  if (typeof value !== 'string' || value === '') {
    throw new MongoShellSyntaxError(`${what} takes a name.`, node ?? at)
  }
  return value
}

export function numberArgument(node: ShellNode | undefined, what: string, at: Node): number {
  const value = node ? shellValue(node) : undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new MongoShellSyntaxError(`${what} takes a whole number.`, node ?? at)
  }
  return value
}

/** explain()'s argument as mongosh reads it: a verbosity name, or true for the most detail. */
export function explainVerbosity(node: ShellNode | undefined): MongoExplainVerbosity {
  const value = node ? shellValue(node) : 'queryPlanner'
  if (value === true) {
    return 'allPlansExecution'
  }
  if (value === false) {
    return 'queryPlanner'
  }
  const verbosity = EXPLAIN_VERBOSITIES.find((candidate) => candidate === value)
  if (!verbosity) {
    throw new MongoShellSyntaxError(
      `explain() takes ${EXPLAIN_VERBOSITIES.join(', ')} or true.`,
      node ?? 0
    )
  }
  return verbosity
}
