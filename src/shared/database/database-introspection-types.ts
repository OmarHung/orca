import { z } from 'zod'

const objectNameSchema = z.string().min(1).max(256)

export const databaseIntrospectTargetSchema = z.discriminatedUnion('level', [
  z.object({ level: z.literal('schemas') }).strict(),
  z.object({ level: z.literal('relations'), schema: objectNameSchema }).strict(),
  z
    .object({ level: z.literal('columns'), schema: objectNameSchema, relation: objectNameSchema })
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

export type DatabaseIntrospectResult =
  | { level: 'schemas'; schemas: DatabaseSchemaInfo[] }
  | { level: 'relations'; relations: DatabaseRelationInfo[] }
  | { level: 'columns'; columns: DatabaseColumnInfo[] }
