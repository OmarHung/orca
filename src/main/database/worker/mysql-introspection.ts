import type mysql from 'mysql2'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import { mysqlIndexes, mysqlKeys, mysqlRoutines } from './mysql-catalog-objects'
import { queryMysqlRows } from './mysql-client-factory'

// In MySQL a "schema" is a database; hide the server's own.
const SCHEMAS_SQL = `
  select schema_name as name, schema_name = database() as is_current
  from information_schema.schemata
  where schema_name not in ('mysql', 'information_schema', 'performance_schema', 'sys')
  order by schema_name`

const RELATIONS_SQL = `
  select table_name as name, table_type as kind from information_schema.tables
  where table_schema = ? order by table_name`

const COLUMNS_SQL = `
  select column_name as name, column_type as data_type, is_nullable as nullable,
         column_default as default_value, column_key as column_key
  from information_schema.columns
  where table_schema = ? and table_name = ? order by ordinal_position`

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

export async function introspectMysql(
  client: mysql.Connection,
  target: DatabaseIntrospectTarget
): Promise<DatabaseIntrospectResult> {
  switch (target.level) {
    // A MySQL database is what the tree calls a schema.
    case 'databases':
      return { level: 'databases', databases: [] }
    case 'schemas': {
      const rows = await queryMysqlRows(client, SCHEMAS_SQL)
      return {
        level: 'schemas',
        schemas: rows.map((row) => ({
          name: text(row.name),
          isCurrent: Number(row.is_current) === 1
        }))
      }
    }
    case 'relations': {
      const rows = await queryMysqlRows(client, RELATIONS_SQL, [target.schema])
      return {
        level: 'relations',
        relations: rows.map((row) => ({
          name: text(row.name),
          kind: text(row.kind).endsWith('VIEW') ? 'view' : 'table'
        }))
      }
    }
    case 'columns': {
      const rows = await queryMysqlRows(client, COLUMNS_SQL, [target.schema, target.relation])
      return {
        level: 'columns',
        columns: rows.map((row) => ({
          name: text(row.name),
          dataType: text(row.data_type),
          nullable: row.nullable === 'YES',
          defaultValue: row.default_value === null ? null : text(row.default_value),
          isPrimaryKey: row.column_key === 'PRI'
        }))
      }
    }
    case 'routines':
      return { level: 'routines', routines: await mysqlRoutines(client, target.schema) }
    case 'keys':
      return { level: 'keys', keys: await mysqlKeys(client, target.schema, target.relation) }
    case 'indexes':
      return {
        level: 'indexes',
        indexes: await mysqlIndexes(client, target.schema, target.relation)
      }
  }
}
