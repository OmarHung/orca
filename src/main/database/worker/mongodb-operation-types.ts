import type { CallExpression, Expression, Node, SpreadElement } from 'acorn'
import type { CollationOptions, Document } from 'mongodb'

/** What one mongosh-style console statement asks the driver to do; every kind only reads. */

export type MongoExplainVerbosity = 'queryPlanner' | 'executionStats' | 'allPlansExecution'
export const EXPLAIN_VERBOSITIES: readonly MongoExplainVerbosity[] = [
  'queryPlanner',
  'executionStats',
  'allPlansExecution'
]

export type InDatabase = { database: string | undefined; collection: string }

export type MongoFindOptions = {
  projection?: Document
  sort?: Document
  skip?: number
  limit?: number
  hint?: Document | string
  collation?: CollationOptions
  maxTimeMS?: number
  comment?: unknown
}

export type MongoOperation =
  | { kind: 'showDatabases' }
  | { kind: 'showCollections'; database: string | undefined }
  | { kind: 'use'; database: string }
  | (InDatabase & {
      kind: 'find'
      filter: Document
      options: MongoFindOptions
      /** count() or size() after find: the matching count instead of documents. */
      count: 'none' | 'all' | 'window'
      explain: MongoExplainVerbosity | null
    })
  | (InDatabase & {
      kind: 'aggregate'
      pipeline: Document[]
      options: Document
      explain: MongoExplainVerbosity | null
    })
  | (InDatabase & { kind: 'countDocuments'; filter: Document; options: Document })
  | (InDatabase & { kind: 'estimatedCount' })
  | (InDatabase & { kind: 'distinct'; field: string; filter: Document })
  | (InDatabase & { kind: 'indexes' })
  | (InDatabase & { kind: 'collectionStats' })
  | { kind: 'command'; database: string | undefined; admin: boolean; command: Document }
  | { kind: 'collectionNames'; database: string | undefined }
  | { kind: 'collectionInfos'; database: string | undefined; filter: Document }
  | { kind: 'databaseStats'; database: string | undefined }

/** One link of `db.a.find(x).sort(y)`: a property read or a method call. */
export type Step =
  | { kind: 'get'; name: string; node: Node }
  | { kind: 'call'; name: string; args: (Expression | SpreadElement)[]; node: CallExpression }

export type CallStep = Extract<Step, { kind: 'call' }>
