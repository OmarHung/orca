import type {
  DatabaseIndexInfo,
  DatabaseKeyInfo
} from '../../../shared/database/database-introspection-types'

export type CatalogRow = Record<string, unknown>

export const catalogText = (value: unknown): string =>
  typeof value === 'string' ? value : String(value ?? '')

/** Folds one row per column into one entry per `name`, keeping first-seen order. */
export function groupByName<T>(
  rows: readonly CatalogRow[],
  create: (row: CatalogRow) => T,
  add: (entry: T, row: CatalogRow) => T
): T[] {
  const entries = new Map<string, T>()
  for (const row of rows) {
    const name = catalogText(row.name)
    entries.set(name, add(entries.get(name) ?? create(row), row))
  }
  return [...entries.values()]
}

/** Keys from rows of name, kind, column_name and (for foreign keys) ref_schema/ref_relation/ref_column. */
export function groupKeyRows(
  rows: readonly CatalogRow[],
  kindOf: (row: CatalogRow) => DatabaseKeyInfo['kind']
): DatabaseKeyInfo[] {
  return groupByName<DatabaseKeyInfo>(
    rows,
    (row) => ({
      name: catalogText(row.name),
      kind: kindOf(row),
      columns: [],
      references: row.ref_relation
        ? {
            schema: catalogText(row.ref_schema),
            relation: catalogText(row.ref_relation),
            columns: []
          }
        : null
    }),
    (key, row) => ({
      ...key,
      columns: [...key.columns, catalogText(row.column_name)],
      references: key.references && {
        ...key.references,
        columns: [...key.references.columns, catalogText(row.ref_column)]
      }
    })
  )
}

/** Indexes from rows of name and column_name, one per indexed column in order. */
export function groupIndexRows(
  rows: readonly CatalogRow[],
  flags: (row: CatalogRow) => { unique: boolean; primary: boolean }
): DatabaseIndexInfo[] {
  return groupByName<DatabaseIndexInfo>(
    rows,
    (row) => ({ name: catalogText(row.name), columns: [], ...flags(row) }),
    (index, row) => ({ ...index, columns: [...index.columns, catalogText(row.column_name)] })
  )
}
