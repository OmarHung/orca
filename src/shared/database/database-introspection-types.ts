import { z } from 'zod'

const objectNameSchema = z.string().min(1).max(256)
/** PostgreSQL and SQL Server servers hold several databases; absent means the connection's. */
const databaseField = { database: objectNameSchema.optional() }
const inSchema = { ...databaseField, schema: objectNameSchema }
const inRelation = { ...inSchema, relation: objectNameSchema }

export const databaseIntrospectTargetSchema = z.discriminatedUnion('level', [
  z.object({ level: z.literal('databases') }).strict(),
  z.object({ level: z.literal('schemas'), ...databaseField }).strict(),
  z.object({ level: z.literal('relations'), ...inSchema }).strict(),
  z.object({ level: z.literal('columns'), ...inRelation }).strict(),
  z.object({ level: z.literal('routines'), ...inSchema }).strict(),
  z.object({ level: z.literal('keys'), ...inRelation }).strict(),
  z.object({ level: z.literal('indexes'), ...inRelation }).strict()
])

export type DatabaseIntrospectTarget = z.infer<typeof databaseIntrospectTargetSchema>

export type DatabaseRelationKind =
  | 'table'
  | 'partitioned-table'
  | 'view'
  | 'materialized-view'
  | 'foreign-table'

/** `isCurrent` marks where unqualified names resolve (search_path, current database, …). */
export type DatabaseSchemaInfo = { name: string; isCurrent: boolean }

export type DatabaseRelationInfo = { name: string; kind: DatabaseRelationKind }

export type DatabaseColumnInfo = {
  name: string
  dataType: string
  nullable: boolean
  defaultValue: string | null
  isPrimaryKey: boolean
}

export type DatabaseRoutineInfo = {
  name: string
  kind: 'function' | 'procedure'
  /** Tells overloads apart, e.g. PostgreSQL's `public.add(integer, integer)`. */
  identity: string
  /** The argument list as the server prints it; empty where it has none to report. */
  arguments: string
}

export type DatabaseKeyInfo = {
  name: string
  kind: 'primary' | 'unique' | 'foreign'
  columns: string[]
  /** What a foreign key points at. */
  references: { schema: string; relation: string; columns: string[] } | null
}

export type DatabaseIndexInfo = {
  name: string
  /** Column names, or the expression text for expression indexes. */
  columns: string[]
  unique: boolean
  primary: boolean
}

export type DatabaseIntrospectResult =
  | { level: 'databases'; databases: DatabaseSchemaInfo[] }
  | { level: 'schemas'; schemas: DatabaseSchemaInfo[] }
  | { level: 'relations'; relations: DatabaseRelationInfo[] }
  | { level: 'columns'; columns: DatabaseColumnInfo[] }
  | { level: 'routines'; routines: DatabaseRoutineInfo[] }
  | { level: 'keys'; keys: DatabaseKeyInfo[] }
  | { level: 'indexes'; indexes: DatabaseIndexInfo[] }
