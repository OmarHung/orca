import type { DatabaseSync } from 'node:sqlite'
import type {
  DatabaseObjectProperties,
  DatabasePropertiesTarget,
  DatabasePropertySection
} from '../../../shared/database/database-properties-types'
import { quoteSqlName } from '../../../shared/database/sql-identifiers'
import { optionalReadSync, property, propertyText } from './database-property-values'

type Row = Record<string, unknown>

const AUTO_VACUUM: Record<string, string> = { '0': 'none', '1': 'full', '2': 'incremental' }
// table_xinfo's `hidden` for a virtual table's hidden columns (2 and 3 are generated ones).
const HIDDEN_COLUMN = 1

const q = (name: string): string => quoteSqlName(name, 'sqlite')

function rows(database: DatabaseSync, sql: string, ...values: string[]): Row[] {
  return database.prepare(sql).all(...values)
}

/** One value of a read-only PRAGMA, in `schema` when it takes one. */
function pragmaValue(database: DatabaseSync, name: string, schema?: string): unknown {
  const [row] = rows(database, `PRAGMA ${schema === undefined ? '' : `${q(schema)}.`}${name}`)
  return row ? Object.values(row)[0] : undefined
}

function databaseSection(
  database: DatabaseSync,
  schema: string,
  notes: string[]
): DatabasePropertySection {
  const file = rows(database, 'PRAGMA database_list').find((row) => row.name === schema)
  if (!file) {
    throw new Error(`Database ${schema} is not attached.`)
  }
  const pageSize = Number(pragmaValue(database, 'page_size', schema))
  const pageCount = Number(pragmaValue(database, 'page_count', schema))
  const [tables] =
    optionalReadSync(notes, 'table count', () =>
      rows(
        database,
        `select count(*) as count from ${q(schema)}.sqlite_master
         where type = 'table' and name not like 'sqlite\\_%' escape '\\'`
      )
    ) ?? []
  return {
    kind: 'database',
    name: schema,
    properties: [
      ...property('file', file.file),
      // Every attached database shares the main one's encoding.
      ...property('encoding', pragmaValue(database, 'encoding')),
      ...property('pageSize', pageSize, 'bytes'),
      ...property('pageCount', pageCount, 'count'),
      ...property('freePages', pragmaValue(database, 'freelist_count', schema), 'count'),
      ...property('size', pageSize * pageCount, 'bytes'),
      ...property('tableCount', tables?.count, 'count'),
      ...property('journalMode', pragmaValue(database, 'journal_mode', schema)),
      ...property('autoVacuum', AUTO_VACUUM[String(pragmaValue(database, 'auto_vacuum', schema))]),
      ...property('userVersion', pragmaValue(database, 'user_version', schema)),
      ...property('applicationId', pragmaValue(database, 'application_id', schema))
    ]
  }
}

/** PRAGMA table_list (SQLite 3.37) reads STRICT and WITHOUT ROWID; older ones parse the SQL. */
function tableShape(database: DatabaseSync, schema: string, relation: string, sql: string): Row {
  try {
    const [row] = rows(database, `PRAGMA ${q(schema)}.table_list(${q(relation)})`)
    if (row) {
      return { without_rowid: row.wr, strict: row.strict, column_count: row.ncol }
    }
  } catch {
    // An older SQLite: no table_list.
  }
  return {
    without_rowid: /\bwithout\s+rowid\b/i.test(sql),
    strict: /\)\s*(?:without\s+rowid\s*,\s*)?strict\b/i.test(sql)
  }
}

/** The next AUTOINCREMENT value: sqlite_sequence keeps the last one handed out. */
function autoIncrement(database: DatabaseSync, schema: string, relation: string): unknown {
  const [sequenceTable] = rows(
    database,
    `select 1 from ${q(schema)}.sqlite_master where type = 'table' and name = 'sqlite_sequence'`
  )
  if (!sequenceTable) {
    return undefined
  }
  const [row] = rows(
    database,
    `select seq from ${q(schema)}.sqlite_sequence where name = ?`,
    relation
  )
  return row?.seq === undefined || row.seq === null ? undefined : BigInt(String(row.seq)) + 1n
}

function relationProperties(
  database: DatabaseSync,
  schema: string,
  relation: string,
  notes: string[]
): DatabaseObjectProperties {
  const [object] = rows(
    database,
    `select type, sql from ${q(schema)}.sqlite_master where name = ? and type in ('table', 'view')`,
    relation
  )
  if (!object) {
    throw new Error(`Table ${schema}.${relation} was not found.`)
  }
  const isView = object.type === 'view'
  const sql = String(object.sql ?? '')
  const shape = isView ? undefined : tableShape(database, schema, relation, sql)
  const columns = rows(database, `PRAGMA ${q(schema)}.table_xinfo(${q(relation)})`).filter(
    (column) => Number(column.hidden) !== HIDDEN_COLUMN
  )
  const properties = [
    ...property(
      'type',
      /^\s*create\s+virtual\s+table\b/i.test(sql) ? 'virtual table' : object.type
    ),
    ...(shape ? property('withoutRowid', shape.without_rowid, 'boolean') : []),
    ...(shape ? property('strict', shape.strict, 'boolean') : []),
    ...property('columnCount', shape?.column_count ?? columns.length, 'count'),
    ...(isView ? [] : property('autoIncrement', autoIncrement(database, schema, relation), 'count'))
  ]
  return {
    sections: [{ kind: isView ? 'view' : 'table', name: relation, properties }],
    columns: columns.map((column) => ({
      name: String(column.name),
      dataType: String(column.type ?? ''),
      nullable: Number(column.notnull) === 0,
      defaultValue: propertyText(column.dflt_value),
      characterSet: null,
      collation: null,
      comment: null
    })),
    notes
  }
}

function sqliteVersion(database: DatabaseSync): unknown {
  return rows(database, 'select sqlite_version() as version')[0]?.version
}

/** SQLite: its "schemas" are the main file and attached ones; no server beyond the library. */
export function sqliteProperties(
  database: DatabaseSync,
  target: DatabasePropertiesTarget
): DatabaseObjectProperties {
  const notes: string[] = []
  switch (target.kind) {
    case 'server': {
      const server: DatabasePropertySection = {
        kind: 'server',
        name: null,
        properties: property('version', sqliteVersion(database))
      }
      return { sections: [server, databaseSection(database, 'main', notes)], columns: null, notes }
    }
    case 'database':
      return { sections: [databaseSection(database, target.database, notes)], columns: null, notes }
    case 'schema':
      return { sections: [databaseSection(database, target.schema, notes)], columns: null, notes }
    case 'relation':
      return relationProperties(database, target.schema, target.relation, notes)
  }
}
