import { z } from 'zod'

const objectNameSchema = z.string().min(1).max(256)

export const databaseIntrospectTargetSchema = z.discriminatedUnion('level', [
  z.object({ level: z.literal('schemas') }).strict(),
  z.object({ level: z.literal('relations'), schema: objectNameSchema }).strict(),
  z
    .object({ level: z.literal('columns'), schema: objectNameSchema, relation: objectNameSchema })
    .strict(),
  z.object({ level: z.literal('routines'), schema: objectNameSchema }).strict(),
  z
    .object({ level: z.literal('keys'), schema: objectNameSchema, relation: objectNameSchema })
    .strict(),
  z
    .object({ level: z.literal('indexes'), schema: objectNameSchema, relation: objectNameSchema })
    .strict()
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
  | { level: 'schemas'; schemas: DatabaseSchemaInfo[] }
  | { level: 'relations'; relations: DatabaseRelationInfo[] }
  | { level: 'columns'; columns: DatabaseColumnInfo[] }
  | { level: 'routines'; routines: DatabaseRoutineInfo[] }
  | { level: 'keys'; keys: DatabaseKeyInfo[] }
  | { level: 'indexes'; indexes: DatabaseIndexInfo[] }
