import { z } from 'zod'
import type { DatabaseDriver } from './database-connection-types'
import { qualifiedRelationName, quoteSqlName } from './sql-identifiers'
import { sqlLiteral } from './sql-literals'

export type TableChangeValue = string | null

// Why bounded: the change set crosses IPC from the renderer and reaches the server.
const MAX_CHANGES = 10_000
const MAX_VALUE_CHARS = 16 * 1024 * 1024

const nameSchema = z.string().min(1).max(256)
const valueSchema = z.string().max(MAX_VALUE_CHARS).nullable()
const assignmentSchema = z.object({ column: nameSchema, value: valueSchema }).strict()

const tableChangeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('update'),
      key: z.array(valueSchema).min(1),
      set: z.array(assignmentSchema).min(1)
    })
    .strict(),
  z.object({ kind: z.literal('insert'), values: z.array(assignmentSchema) }).strict(),
  z.object({ kind: z.literal('delete'), key: z.array(valueSchema).min(1) }).strict()
])

export const tableChangeSetSchema = z
  .object({
    schema: nameSchema,
    relation: nameSchema,
    keyColumns: z.array(nameSchema).min(1).max(32),
    changes: z.array(tableChangeSchema).min(1).max(MAX_CHANGES)
  })
  .strict()
  .refine(
    (set) =>
      set.changes.every(
        (change) => change.kind === 'insert' || change.key.length === set.keyColumns.length
      ),
    { message: 'Each key must give one value per key column' }
  )

export type TableChange = z.infer<typeof tableChangeSchema>

/** Edits to one table's rows, in the order they run: deletes, updates, then inserts. */
export type TableChangeSet = z.infer<typeof tableChangeSetSchema>

export type ParameterizedStatement = {
  sql: string
  params: TableChangeValue[]
  /** UPDATE and DELETE target one row by its key; any other count means the row changed. */
  expectOneRow: boolean
}

type RenderValue = (value: TableChangeValue, column: string) => string

const PLACEHOLDERS: Record<DatabaseDriver, (position: number) => string> = {
  postgres: (position) => `$${position}`,
  mysql: () => '?',
  sqlite: () => '?',
  sqlserver: (position) => `@p${position}`
}

function buildStatement(
  driver: DatabaseDriver,
  set: TableChangeSet,
  change: TableChange,
  render: RenderValue
): string {
  const table = qualifiedRelationName(set.schema, set.relation, driver)
  const name = (column: string): string => quoteSqlName(column, driver)
  const assign = (column: string, value: TableChangeValue): string =>
    `${name(column)} = ${render(value, column)}`
  const where = (key: readonly TableChangeValue[]): string =>
    set.keyColumns.map((column, index) => assign(column, key[index] ?? null)).join(' AND ')
  switch (change.kind) {
    case 'delete':
      return `DELETE FROM ${table} WHERE ${where(change.key)}`
    case 'update': {
      // Why computed before WHERE: positional placeholders must follow the SQL text order.
      const assignments = change.set.map(({ column, value }) => assign(column, value)).join(', ')
      return `UPDATE ${table} SET ${assignments} WHERE ${where(change.key)}`
    }
    case 'insert': {
      if (change.values.length === 0) {
        return driver === 'mysql'
          ? `INSERT INTO ${table} () VALUES ()`
          : `INSERT INTO ${table} DEFAULT VALUES`
      }
      const columns = change.values.map(({ column }) => name(column)).join(', ')
      const values = change.values.map(({ column, value }) => render(value, column)).join(', ')
      return `INSERT INTO ${table} (${columns}) VALUES (${values})`
    }
  }
}

/** The statements that apply a change set; every value is bound, never written into SQL. */
export function tableChangeStatements(
  driver: DatabaseDriver,
  set: TableChangeSet
): ParameterizedStatement[] {
  return set.changes.map((change) => {
    const params: TableChangeValue[] = []
    const sql = buildStatement(driver, set, change, (value) => {
      params.push(value)
      return PLACEHOLDERS[driver](params.length)
    })
    return { sql, params, expectOneRow: change.kind !== 'insert' }
  })
}

/** The same statements written out with literals, for a person to review before submitting. */
export function tableChangePreview(
  driver: DatabaseDriver,
  set: TableChangeSet,
  numericColumns: ReadonlySet<string>
): string {
  return set.changes
    .map(
      (change) =>
        `${buildStatement(driver, set, change, (value, column) =>
          sqlLiteral(value, numericColumns.has(column), driver)
        )};`
    )
    .join('\n')
}
