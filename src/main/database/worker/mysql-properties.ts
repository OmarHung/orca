import type mysql from 'mysql2'
import type {
  DatabaseColumnProperties,
  DatabaseObjectProperties,
  DatabasePropertiesTarget,
  DatabasePropertySection
} from '../../../shared/database/database-properties-types'
import { queryMysqlRows } from './mysql-client-factory'
import { optionalRead, property, propertyFlag, propertyText } from './database-property-values'

const SERVER_SQL = `
  select @@version as version, @@version_comment as edition,
         @@character_set_server as character_set, @@collation_server as collation,
         @@default_storage_engine as default_engine,
         if(@@time_zone = 'SYSTEM', concat('SYSTEM (', @@system_time_zone, ')'), @@time_zone) as time_zone,
         database() as current_database`

// Why *: MySQL 8 adds DEFAULT_ENCRYPTION, MariaDB 10.5 adds SCHEMA_COMMENT.
const SCHEMA_SQL = 'select * from information_schema.SCHEMATA where SCHEMA_NAME = ?'

const SCHEMA_TABLES_SQL = `
  select count(*) as table_count, sum(DATA_LENGTH + INDEX_LENGTH) as size
  from information_schema.TABLES where TABLE_SCHEMA = ? and TABLE_TYPE = 'BASE TABLE'`

const TABLE_SQL = `
  select TABLE_TYPE, ENGINE, ROW_FORMAT, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, DATA_FREE,
         AUTO_INCREMENT, CREATE_TIME, UPDATE_TIME, TABLE_COLLATION, CREATE_OPTIONS, TABLE_COMMENT
  from information_schema.TABLES where TABLE_SCHEMA = ? and TABLE_NAME = ?`

const VIEW_SQL = `
  select DEFINER, SECURITY_TYPE, CHECK_OPTION, IS_UPDATABLE
  from information_schema.VIEWS where TABLE_SCHEMA = ? and TABLE_NAME = ?`

const COLUMNS_SQL = `
  select COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_SET_NAME,
         COLLATION_NAME, COLUMN_COMMENT
  from information_schema.COLUMNS where TABLE_SCHEMA = ? and TABLE_NAME = ?
  order by ORDINAL_POSITION`

/** A collation's character set: MySQL names every collation after its set (`latin1_…`). */
function characterSetOf(collation: unknown): string | null {
  const name = propertyText(collation)
  return name === null ? null : (name.split('_')[0] ?? null)
}

async function databaseSection(
  client: mysql.Connection,
  schema: string,
  notes: string[]
): Promise<DatabasePropertySection> {
  const [row] = await queryMysqlRows(client, SCHEMA_SQL, [schema])
  if (!row) {
    throw new Error(`Database ${schema} was not found.`)
  }
  const [tables] =
    (await optionalRead(notes, 'table count and size', () =>
      queryMysqlRows(client, SCHEMA_TABLES_SQL, [schema])
    )) ?? []
  return {
    kind: 'database',
    name: schema,
    properties: [
      ...property('characterSet', row.DEFAULT_CHARACTER_SET_NAME),
      ...property('collation', row.DEFAULT_COLLATION_NAME),
      ...property('encryption', row.DEFAULT_ENCRYPTION, 'boolean'),
      ...property('tableCount', tables?.table_count, 'count'),
      ...property('size', tables?.size, 'bytes'),
      ...property('comment', row.SCHEMA_COMMENT)
    ]
  }
}

async function serverProperties(
  client: mysql.Connection,
  notes: string[]
): Promise<DatabaseObjectProperties> {
  const [row] = await queryMysqlRows(client, SERVER_SQL)
  const server: DatabasePropertySection = {
    kind: 'server',
    name: null,
    properties: [
      ...property('version', row?.version),
      ...property('edition', row?.edition),
      ...property('characterSet', row?.character_set),
      ...property('collation', row?.collation),
      ...property('defaultEngine', row?.default_engine),
      ...property('timeZone', row?.time_zone)
    ]
  }
  const current = propertyText(row?.current_database)
  const database = current === null ? null : await databaseSection(client, current, notes)
  return { sections: database ? [server, database] : [server], columns: null, notes }
}

/** MySQL 8 caches TABLES statistics for a day; a fresh read shows today's sizes and counters. */
async function withFreshStatistics<T>(
  client: mysql.Connection,
  read: () => Promise<T>
): Promise<T> {
  // Why ignored: MariaDB has no such cache, nor the setting.
  const fresh = await queryMysqlRows(client, 'SET SESSION information_schema_stats_expiry = 0')
    .then(() => true)
    .catch(() => false)
  try {
    return await read()
  } finally {
    if (fresh) {
      await queryMysqlRows(client, 'SET SESSION information_schema_stats_expiry = DEFAULT')
    }
  }
}

function tableProperties(row: Record<string, unknown>): DatabasePropertySection['properties'] {
  return [
    ...property('type', row.TABLE_TYPE),
    ...property('engine', row.ENGINE),
    ...property('rowFormat', row.ROW_FORMAT),
    ...property('characterSet', characterSetOf(row.TABLE_COLLATION)),
    ...property('collation', row.TABLE_COLLATION),
    ...property('autoIncrement', row.AUTO_INCREMENT, 'count'),
    ...property('rowsEstimate', row.TABLE_ROWS, 'count'),
    ...property('dataSize', row.DATA_LENGTH, 'bytes'),
    ...property('indexSize', row.INDEX_LENGTH, 'bytes'),
    ...property('dataFree', row.DATA_FREE, 'bytes'),
    ...property('createOptions', row.CREATE_OPTIONS),
    ...property('created', row.CREATE_TIME, 'datetime'),
    ...property('dataUpdated', row.UPDATE_TIME, 'datetime'),
    ...property('comment', row.TABLE_COMMENT)
  ]
}

function viewProperties(
  row: Record<string, unknown> | undefined
): DatabasePropertySection['properties'] {
  return [
    ...property('type', 'VIEW'),
    ...property('definer', row?.DEFINER),
    ...property('securityType', row?.SECURITY_TYPE),
    ...property('checkOption', row?.CHECK_OPTION),
    ...property('updatable', row?.IS_UPDATABLE, 'boolean')
  ]
}

async function relationProperties(
  client: mysql.Connection,
  schema: string,
  relation: string,
  notes: string[]
): Promise<DatabaseObjectProperties> {
  const [row] = await withFreshStatistics(client, () =>
    queryMysqlRows(client, TABLE_SQL, [schema, relation])
  )
  if (!row) {
    throw new Error(`Table ${schema}.${relation} was not found.`)
  }
  const isView = String(row.TABLE_TYPE).endsWith('VIEW')
  const [view] = isView ? await queryMysqlRows(client, VIEW_SQL, [schema, relation]) : []
  const columns = await queryMysqlRows(client, COLUMNS_SQL, [schema, relation])
  return {
    sections: [
      {
        kind: isView ? 'view' : 'table',
        name: relation,
        properties: isView ? viewProperties(view) : tableProperties(row)
      }
    ],
    columns: columns.map((column): DatabaseColumnProperties => ({
      name: String(column.COLUMN_NAME),
      dataType: String(column.COLUMN_TYPE),
      nullable: propertyFlag(column.IS_NULLABLE) === true,
      defaultValue: propertyText(column.COLUMN_DEFAULT),
      characterSet: propertyText(column.CHARACTER_SET_NAME),
      collation: propertyText(column.COLLATION_NAME),
      comment: propertyText(column.COLUMN_COMMENT)
    })),
    notes
  }
}

/** MySQL and MariaDB: a database is what the tree calls a schema. */
export async function mysqlProperties(
  client: mysql.Connection,
  target: DatabasePropertiesTarget
): Promise<DatabaseObjectProperties> {
  const notes: string[] = []
  switch (target.kind) {
    case 'server':
      return serverProperties(client, notes)
    case 'database':
      return {
        sections: [await databaseSection(client, target.database, notes)],
        columns: null,
        notes
      }
    case 'schema':
      return {
        sections: [await databaseSection(client, target.schema, notes)],
        columns: null,
        notes
      }
    case 'relation':
      return relationProperties(client, target.schema, target.relation, notes)
  }
}
