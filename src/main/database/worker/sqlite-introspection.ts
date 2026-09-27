import type { DatabaseSync } from 'node:sqlite'
import type {
  DatabaseIndexInfo,
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget,
  DatabaseKeyInfo
} from '../../../shared/database/database-introspection-types'
import { catalogText, groupByName } from './catalog-row-grouping'

export function quoteSqliteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function pragma(
  database: DatabaseSync,
  schema: string,
  name: string,
  argument: string
): Record<string, unknown>[] {
  const sql = `PRAGMA ${quoteSqliteIdentifier(schema)}.${name}(${quoteSqliteIdentifier(argument)})`
  return database.prepare(sql).all()
}

function indexColumns(database: DatabaseSync, schema: string, index: string): string[] {
  // A null name is an expression (or the rowid) in an expression index.
  return pragma(database, schema, 'index_info', index).map((row) =>
    row.name === null ? '(expression)' : catalogText(row.name)
  )
}

// SQLite doesn't report constraint names, so keys are unnamed here.
function sqliteKeys(database: DatabaseSync, schema: string, relation: string): DatabaseKeyInfo[] {
  const primary = pragma(database, schema, 'table_info', relation)
    .filter((row) => Number(row.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((row) => catalogText(row.name))
  const unique = pragma(database, schema, 'index_list', relation)
    .filter((row) => row.origin === 'u')
    .map((row) => ({
      name: '',
      kind: 'unique' as const,
      columns: indexColumns(database, schema, catalogText(row.name)),
      references: null
    }))
  const foreign = groupByName<DatabaseKeyInfo>(
    pragma(database, schema, 'foreign_key_list', relation).map((row) => ({
      ...row,
      name: String(row.id)
    })),
    (row) => ({
      name: '',
      kind: 'foreign',
      columns: [],
      references: { schema, relation: catalogText(row.table), columns: [] }
    }),
    (key, row) => ({
      ...key,
      columns: [...key.columns, catalogText(row.from)],
      // A null target column means the referenced table's primary key.
      references: key.references && {
        ...key.references,
        columns:
          row.to === null
            ? key.references.columns
            : [...key.references.columns, catalogText(row.to)]
      }
    })
  )
  const primaryKey: DatabaseKeyInfo[] =
    primary.length > 0 ? [{ name: '', kind: 'primary', columns: primary, references: null }] : []
  return [...primaryKey, ...unique, ...foreign]
}

function sqliteIndexes(
  database: DatabaseSync,
  schema: string,
  relation: string
): DatabaseIndexInfo[] {
  return pragma(database, schema, 'index_list', relation)
    .map((row) => ({
      name: catalogText(row.name),
      columns: indexColumns(database, schema, catalogText(row.name)),
      unique: Number(row.unique) === 1,
      primary: row.origin === 'pk'
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name))
}

export function introspectSqlite(
  database: DatabaseSync,
  target: DatabaseIntrospectTarget
): DatabaseIntrospectResult {
  switch (target.level) {
    case 'schemas':
      return {
        level: 'schemas',
        schemas: database
          .prepare('PRAGMA database_list')
          .all()
          .map((row) => String(row.name))
          .filter((name) => name !== 'temp')
          .map((name) => ({ name, isCurrent: name === 'main' }))
      }
    case 'relations':
      return {
        level: 'relations',
        relations: database
          .prepare(
            `select name, type from ${quoteSqliteIdentifier(target.schema)}.sqlite_master
             where type in ('table', 'view') and name not like 'sqlite_%' order by name`
          )
          .all()
          .map((row) => ({ name: String(row.name), kind: row.type === 'view' ? 'view' : 'table' }))
      }
    case 'columns':
      return {
        level: 'columns',
        columns: pragma(database, target.schema, 'table_xinfo', target.relation)
          // hidden = 1 marks virtual-table internals; generated columns (2, 3) are real.
          .filter((row) => Number(row.hidden) !== 1)
          .map((row) => ({
            name: String(row.name),
            dataType: String(row.type ?? ''),
            nullable: Number(row.notnull) === 0,
            defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
            isPrimaryKey: Number(row.pk) > 0
          }))
      }
    // SQLite has no stored routines.
    case 'routines':
      return { level: 'routines', routines: [] }
    case 'keys':
      return { level: 'keys', keys: sqliteKeys(database, target.schema, target.relation) }
    case 'indexes':
      return {
        level: 'indexes',
        indexes: sqliteIndexes(database, target.schema, target.relation)
      }
  }
}
