import type mysql from 'mysql2'
import type {
  DatabaseIndexInfo,
  DatabaseKeyInfo,
  DatabaseRoutineInfo
} from '../../../shared/database/database-introspection-types'
import { catalogText as text, groupIndexRows, groupKeyRows } from './catalog-row-grouping'
import { queryMysqlRows } from './mysql-client-factory'

// Aliased lower-case: MySQL 8 names information_schema columns in upper case.
const ROUTINES_SQL = `
  select r.routine_name as name, r.routine_type as type,
         (select group_concat(concat(p.parameter_name, ' ', p.dtd_identifier)
                              order by p.ordinal_position separator ', ')
          from information_schema.parameters p
          where p.specific_schema = r.routine_schema and p.specific_name = r.specific_name
            and p.ordinal_position > 0) as arguments
  from information_schema.routines r
  where r.routine_schema = ?
  order by r.routine_name`

const KEYS_SQL = `
  select tc.constraint_name as name, tc.constraint_type as type, k.column_name as column_name,
         k.referenced_table_schema as ref_schema, k.referenced_table_name as ref_relation,
         k.referenced_column_name as ref_column
  from information_schema.table_constraints tc
  join information_schema.key_column_usage k
    on k.constraint_schema = tc.constraint_schema and k.constraint_name = tc.constraint_name
   and k.table_schema = tc.table_schema and k.table_name = tc.table_name
  where tc.table_schema = ? and tc.table_name = ?
    and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
  order by field(tc.constraint_type, 'PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY'),
           tc.constraint_name, k.ordinal_position`

// A functional index (MySQL 8.0.13) has no column name; its expression column isn't on MariaDB.
const INDEXES_SQL = `
  select index_name as name, non_unique as non_unique,
         coalesce(column_name, '(expression)') as column_name
  from information_schema.statistics
  where table_schema = ? and table_name = ?
  order by index_name = 'PRIMARY' desc, index_name, seq_in_index`

const KEY_KINDS: Record<string, DatabaseKeyInfo['kind']> = {
  'PRIMARY KEY': 'primary',
  UNIQUE: 'unique',
  'FOREIGN KEY': 'foreign'
}

export async function mysqlRoutines(
  client: mysql.Connection,
  schema: string
): Promise<DatabaseRoutineInfo[]> {
  const rows = await queryMysqlRows(client, ROUTINES_SQL, [schema])
  return rows.map((row) => ({
    name: text(row.name),
    kind: text(row.type) === 'PROCEDURE' ? 'procedure' : 'function',
    identity: text(row.name),
    arguments: row.arguments === null ? '' : text(row.arguments)
  }))
}

export async function mysqlKeys(
  client: mysql.Connection,
  schema: string,
  relation: string
): Promise<DatabaseKeyInfo[]> {
  const rows = await queryMysqlRows(client, KEYS_SQL, [schema, relation])
  return groupKeyRows(rows, (row) => KEY_KINDS[text(row.type)] ?? 'unique')
}

export async function mysqlIndexes(
  client: mysql.Connection,
  schema: string,
  relation: string
): Promise<DatabaseIndexInfo[]> {
  const rows = await queryMysqlRows(client, INDEXES_SQL, [schema, relation])
  return groupIndexRows(rows, (row) => ({
    unique: Number(row.non_unique) === 0,
    primary: text(row.name) === 'PRIMARY'
  }))
}
