import { z } from 'zod'

const objectNameSchema = z.string().min(1).max(256)
/** Absent means the connection's own database. */
const databaseField = { database: objectNameSchema.optional() }

/**
 * What Properties reads: the server (with the connection's own database), one of a server's
 * databases, a schema (MySQL's databases are its schemas), or a table or view.
 */
export const databasePropertiesTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('server') }).strict(),
  z.object({ kind: z.literal('database'), database: objectNameSchema }).strict(),
  z.object({ kind: z.literal('schema'), ...databaseField, schema: objectNameSchema }).strict(),
  z
    .object({
      kind: z.literal('relation'),
      ...databaseField,
      schema: objectNameSchema,
      relation: objectNameSchema
    })
    .strict()
])

export type DatabasePropertiesTarget = z.infer<typeof databasePropertiesTargetSchema>

export const DATABASE_PROPERTY_KEYS = [
  // Server
  'version',
  'edition',
  'defaultEngine',
  'timeZone',
  // Database and schema
  'owner',
  'encoding',
  'characterSet',
  'collation',
  'ctype',
  'localeProvider',
  'locale',
  'tablespace',
  'connectionLimit',
  'allowConnections',
  'isTemplate',
  'compatibilityLevel',
  'recoveryModel',
  'state',
  'readOnly',
  'snapshotIsolation',
  'readCommittedSnapshot',
  'containment',
  'encryption',
  'tableCount',
  'file',
  'pageSize',
  'pageCount',
  'freePages',
  'journalMode',
  'autoVacuum',
  'userVersion',
  'applicationId',
  // Tables and views
  'type',
  'engine',
  'rowFormat',
  'persistence',
  'accessMethod',
  'options',
  'partitionKey',
  'partitionOf',
  'rowSecurity',
  'memoryOptimized',
  'durability',
  'temporalType',
  'lockEscalation',
  'filegroup',
  'withoutRowid',
  'strict',
  'columnCount',
  'autoIncrement',
  'rowsEstimate',
  'dataSize',
  'indexSize',
  'dataFree',
  'size',
  'createOptions',
  'definer',
  'securityType',
  'checkOption',
  'updatable',
  'schemaBound',
  'populated',
  'created',
  'modified',
  'dataUpdated',
  'comment'
] as const

export type DatabasePropertyKey = (typeof DATABASE_PROPERTY_KEYS)[number]

/** How the page shows a value: sizes and counts arrive as whole numbers in text. */
export type DatabasePropertyFormat = 'text' | 'bytes' | 'count' | 'datetime' | 'boolean'

export type DatabaseProperty = {
  key: DatabasePropertyKey
  value: string
  format: DatabasePropertyFormat
}

export type DatabasePropertySectionKind = 'server' | 'database' | 'schema' | 'table' | 'view'

export type DatabasePropertySection = {
  kind: DatabasePropertySectionKind
  /** The object's name; null for the server. */
  name: string | null
  properties: DatabaseProperty[]
}

export type DatabaseColumnProperties = {
  name: string
  dataType: string
  nullable: boolean
  defaultValue: string | null
  characterSet: string | null
  collation: string | null
  comment: string | null
}

export type DatabaseObjectProperties = {
  sections: DatabasePropertySection[]
  /** A table's or view's columns; null for servers, databases and schemas. */
  columns: DatabaseColumnProperties[] | null
  /** What could not be read, e.g. a size the login lacks the permission to see. */
  notes: string[]
}
