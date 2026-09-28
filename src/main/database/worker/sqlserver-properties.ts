import type { Connection } from 'tedious'
import type {
  DatabaseObjectProperties,
  DatabasePropertiesTarget,
  DatabasePropertySection
} from '../../../shared/database/database-properties-types'
import { optionalRead, property, propertyFlag, propertyText } from './database-property-values'
import { querySqlServerRows } from './sqlserver-client-factory'
import { formatSqlServerColumnType } from './sqlserver-introspection'

type Row = Record<string, unknown>
/** Runs `task` on the metadata session in `database` (the connection's own when undefined). */
export type SqlServerOnMeta = <T>(
  database: string | undefined,
  task: (client: Connection) => Promise<T>
) => Promise<T>

const OBJECT_ID = "object_id(quotename(@schema) + N'.' + quotename(@relation))"
const DESCRIPTION = "ep.name = N'MS_Description'"

const SERVER_SQL = `
  select cast(serverproperty('ProductVersion') as nvarchar(128)) as version,
         cast(serverproperty('Edition') as nvarchar(128)) as edition,
         cast(serverproperty('Collation') as nvarchar(128)) as collation,
         db_name() as current_database`

// Why *: newer servers add columns (containment_desc in 2012, is_ledger_on in 2022).
const DATABASE_SQL = `
  select d.*, suser_sname(d.owner_sid) as owner_name from sys.databases d where d.name = @database`

// Read inside the database: its files and description are visible to any user of it.
const IN_DATABASE_SQL = `
  select (select sum(cast(size as bigint)) * 8192 from sys.database_files) as size,
         (select count(*) from sys.tables) as table_count,
         (select cast(ep.value as nvarchar(max)) from sys.extended_properties ep
          where ep.class = 0 and ${DESCRIPTION}) as comment`

const SCHEMA_SQL = `
  select user_name(s.principal_id) as owner, cast(ep.value as nvarchar(max)) as comment,
         (select count(*) from sys.tables t where t.schema_id = s.schema_id) as table_count
  from sys.schemas s
  left join sys.extended_properties ep
    on ep.class = 3 and ep.major_id = s.schema_id and ep.minor_id = 0 and ${DESCRIPTION}
  where s.name = @schema`

// Why rtrim: sys.objects.type is char(2), 'U ' and 'V '.
const RELATION_SQL = `
  select rtrim(o.type) as type, o.create_date, o.modify_date, ds.name as filegroup,
         objectproperty(o.object_id, 'IsSchemaBound') as schema_bound,
         cast(ep.value as nvarchar(max)) as comment,
         (select sum(p.rows) from sys.partitions p
          where p.object_id = o.object_id and p.index_id in (0, 1)) as row_count
  from sys.objects o
  left join sys.indexes i on i.object_id = o.object_id and i.index_id in (0, 1)
  left join sys.data_spaces ds on ds.data_space_id = i.data_space_id
  left join sys.extended_properties ep
    on ep.class = 1 and ep.major_id = o.object_id and ep.minor_id = 0 and ${DESCRIPTION}
  where o.object_id = ${OBJECT_ID} and o.type in ('U', 'V')`

// Why *: memory-optimized tables arrived in 2014, temporal tables in 2016.
const TABLE_SQL = `select t.* from sys.tables t where t.object_id = ${OBJECT_ID}`
const VIEW_SQL = `select v.with_check_option from sys.views v where v.object_id = ${OBJECT_ID}`

// Needs VIEW DATABASE STATE, which a reader may not have.
const SIZES_SQL = `
  select sum(ps.reserved_page_count) * 8192 as total, sum(ps.used_page_count) * 8192 as used,
         sum(case when ps.index_id in (0, 1)
                  then ps.in_row_data_page_count + ps.lob_used_page_count
                       + ps.row_overflow_used_page_count
                  else 0 end) * 8192 as data
  from sys.dm_db_partition_stats ps where ps.object_id = ${OBJECT_ID}`

const COLUMNS_SQL = `
  select c.name, type_name(c.user_type_id) as type_name, c.max_length, c.precision, c.scale,
         c.is_nullable, object_definition(c.default_object_id) as default_value, c.collation_name,
         cast(ep.value as nvarchar(max)) as comment
  from sys.columns c
  left join sys.extended_properties ep
    on ep.class = 1 and ep.major_id = c.object_id and ep.minor_id = c.column_id and ${DESCRIPTION}
  where c.object_id = ${OBJECT_ID}
  order by c.column_id`

async function databaseSection(
  onMeta: SqlServerOnMeta,
  database: string,
  notes: string[]
): Promise<DatabasePropertySection> {
  const [row] = await onMeta(undefined, (client) =>
    querySqlServerRows(client, DATABASE_SQL, { database })
  )
  if (!row) {
    throw new Error(`Database ${database} was not found.`)
  }
  const [inside] =
    (await optionalRead(notes, 'size and description', () =>
      onMeta(database, (client) => querySqlServerRows(client, IN_DATABASE_SQL))
    )) ?? []
  return {
    kind: 'database',
    name: database,
    properties: [
      ...property('owner', row.owner_name),
      ...property('collation', row.collation_name),
      ...property('compatibilityLevel', row.compatibility_level),
      ...property('recoveryModel', row.recovery_model_desc),
      ...property('state', row.state_desc),
      ...property('readOnly', row.is_read_only, 'boolean'),
      ...property('snapshotIsolation', row.snapshot_isolation_state_desc),
      ...property('readCommittedSnapshot', row.is_read_committed_snapshot_on, 'boolean'),
      ...property('containment', row.containment_desc),
      ...property('encryption', row.is_encrypted, 'boolean'),
      ...property('tableCount', inside?.table_count, 'count'),
      ...property('size', inside?.size, 'bytes'),
      ...property('created', row.create_date, 'datetime'),
      ...property('comment', inside?.comment)
    ]
  }
}

async function serverProperties(
  onMeta: SqlServerOnMeta,
  notes: string[]
): Promise<DatabaseObjectProperties> {
  const [row] = await onMeta(undefined, (client) => querySqlServerRows(client, SERVER_SQL))
  const server: DatabasePropertySection = {
    kind: 'server',
    name: null,
    properties: [
      ...property('version', row?.version),
      ...property('edition', row?.edition),
      ...property('collation', row?.collation)
    ]
  }
  const database = await databaseSection(onMeta, String(row?.current_database), notes)
  return { sections: [server, database], columns: null, notes }
}

function relationEntries(
  row: Row,
  table: Row | undefined,
  view: Row | undefined,
  sizes: Row | undefined
): DatabasePropertySection['properties'] {
  const used = Number(sizes?.used)
  const data = Number(sizes?.data)
  return [
    ...property('type', row.type === 'V' ? 'view' : 'table'),
    ...property('filegroup', row.filegroup),
    ...property('memoryOptimized', table?.is_memory_optimized, 'boolean'),
    ...(propertyFlag(table?.is_memory_optimized)
      ? property('durability', table?.durability_desc)
      : []),
    ...property('temporalType', table?.temporal_type_desc),
    ...property('lockEscalation', table?.lock_escalation_desc),
    ...(row.type === 'V' ? property('schemaBound', row.schema_bound, 'boolean') : []),
    ...(view ? property('checkOption', view.with_check_option, 'boolean') : []),
    ...(row.type === 'U' ? property('rowsEstimate', row.row_count, 'count') : []),
    ...property('dataSize', sizes?.data, 'bytes'),
    ...(sizes && Number.isFinite(used - data) ? property('indexSize', used - data, 'bytes') : []),
    ...property('size', sizes?.total, 'bytes'),
    ...property('created', row.create_date, 'datetime'),
    ...property('modified', row.modify_date, 'datetime'),
    ...property('comment', row.comment)
  ]
}

async function relationProperties(
  client: Connection,
  names: { schema: string; relation: string },
  notes: string[]
): Promise<DatabaseObjectProperties> {
  const [row] = await querySqlServerRows(client, RELATION_SQL, names)
  if (!row) {
    throw new Error(`Table ${names.schema}.${names.relation} was not found.`)
  }
  const isView = row.type === 'V'
  const [table] = isView ? [] : await querySqlServerRows(client, TABLE_SQL, names)
  const [view] = isView ? await querySqlServerRows(client, VIEW_SQL, names) : []
  const [sizes] = isView
    ? []
    : ((await optionalRead(notes, 'sizes', () => querySqlServerRows(client, SIZES_SQL, names))) ??
      [])
  const columns = await querySqlServerRows(client, COLUMNS_SQL, names)
  return {
    sections: [
      {
        kind: isView ? 'view' : 'table',
        name: names.relation,
        properties: relationEntries(row, table, view, sizes)
      }
    ],
    columns: columns.map((column) => ({
      name: String(column.name),
      dataType: formatSqlServerColumnType(column),
      nullable: column.is_nullable === true,
      defaultValue: propertyText(column.default_value),
      characterSet: null,
      collation: propertyText(column.collation_name),
      comment: propertyText(column.comment)
    })),
    notes
  }
}

export async function sqlServerProperties(
  onMeta: SqlServerOnMeta,
  target: DatabasePropertiesTarget
): Promise<DatabaseObjectProperties> {
  const notes: string[] = []
  switch (target.kind) {
    case 'server':
      return serverProperties(onMeta, notes)
    case 'database': {
      const section = await databaseSection(onMeta, target.database, notes)
      return { sections: [section], columns: null, notes }
    }
    case 'schema': {
      const [row] = await onMeta(target.database, (client) =>
        querySqlServerRows(client, SCHEMA_SQL, { schema: target.schema })
      )
      if (!row) {
        throw new Error(`Schema ${target.schema} was not found.`)
      }
      const properties = [
        ...property('owner', row.owner),
        ...property('tableCount', row.table_count, 'count'),
        ...property('comment', row.comment)
      ]
      return {
        sections: [{ kind: 'schema', name: target.schema, properties }],
        columns: null,
        notes
      }
    }
    case 'relation':
      return onMeta(target.database, (client) =>
        relationProperties(client, { schema: target.schema, relation: target.relation }, notes)
      )
  }
}
