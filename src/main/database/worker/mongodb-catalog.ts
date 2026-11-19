import { BSON, type Db, type Document, type MongoClient } from 'mongodb'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import type {
  DatabaseColumnInfo,
  DatabaseIndexInfo,
  DatabaseRelationInfo,
  DatabaseSchemaInfo
} from '../../../shared/database/database-introspection-types'
import { documentOr } from './mongodb-documents'
import { mongoTypeName } from './mongodb-values'

/** How many documents the explorer reads to guess a collection's fields. */
export const MONGO_FIELD_SAMPLE_SIZE = 100

export type MongoCollectionInfo = { name: string; type: string; options: Document }

export async function mongoDatabases(
  client: MongoClient,
  current: string,
  named: string
): Promise<DatabaseSchemaInfo[]> {
  let names: string[]
  try {
    const reply = await client
      .db('admin')
      .command({ listDatabases: 1, nameOnly: true, authorizedDatabases: true })
    names = Array.isArray(reply.databases)
      ? reply.databases.map((entry: Document) => String(entry.name))
      : []
  } catch (error) {
    // Why fall back: a login limited to one database may not list the others.
    if (!named) {
      throw error
    }
    names = []
  }
  // A database shows up in listDatabases only once it holds data; the named one always shows.
  const all = named && !names.includes(named) ? [...names, named] : names
  return all.sort().map((name) => ({ name, isCurrent: name === current }))
}

/** The explorer's collections; MongoDB's own system.* ones stay out, as in Compass. */
export async function mongoCollections(db: Db): Promise<MongoCollectionInfo[]> {
  const infos = await db.listCollections({}, { authorizedCollections: true }).toArray()
  return infos
    .filter((info) => !String(info.name).startsWith('system.'))
    .map((info) => ({
      name: String(info.name),
      type: String(info.type ?? 'collection'),
      options: documentOr('options' in info ? info.options : undefined)
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function relationInfo(info: MongoCollectionInfo): DatabaseRelationInfo {
  return { name: info.name, kind: info.type === 'view' ? 'view' : 'collection', comment: null }
}

/** The fields a sample of documents use, typed by what they hold, `_id` first. */
export async function sampledFields(db: Db, collection: string): Promise<DatabaseColumnInfo[]> {
  const documents = await db
    .collection(collection)
    .find({}, { limit: MONGO_FIELD_SAMPLE_SIZE })
    .toArray()
  const fields = new Map<string, { types: Set<string>; present: number }>()
  for (const document of documents) {
    for (const [name, value] of Object.entries(document)) {
      const field = fields.get(name) ?? { types: new Set<string>(), present: 0 }
      field.types.add(mongoTypeName(value))
      fields.set(name, { types: field.types, present: field.present + 1 })
    }
  }
  return [...fields.entries()]
    .sort(([left], [right]) => (left === '_id' ? -1 : right === '_id' ? 1 : 0))
    .map(([name, field]) => {
      const types = [...field.types].filter((type) => type !== 'null')
      return {
        name,
        dataType: types.length === 0 ? 'null' : types.join(' | '),
        nullable: field.present < documents.length || field.types.has('null'),
        defaultValue: null,
        isPrimaryKey: name === '_id',
        comment: null
      }
    })
}

function keyColumns(key: Document): string[] {
  return Object.entries(key).map(([field, direction]) =>
    direction === 1 ? field : `${field} (${String(direction)})`
  )
}

export async function mongoIndexes(db: Db, collection: string): Promise<DatabaseIndexInfo[]> {
  const indexes = await db.collection(collection).listIndexes().toArray()
  return indexes.map((index) => ({
    name: String(index.name),
    columns: keyColumns(documentOr(index.key)),
    unique: index.unique === true,
    primary: index.name === '_id_'
  }))
}

const json = (value: unknown): string =>
  BSON.EJSON.stringify(value, undefined, 2, { relaxed: true })

/** The mongosh statements that recreate a collection (with its indexes) or a view. */
export async function mongoDdl(db: Db, target: DatabaseDdlTarget): Promise<string> {
  if (target.kind !== 'relation') {
    throw new Error('MongoDB has no routines.')
  }
  const [info] = await db.listCollections({ name: target.relation }).toArray()
  if (!info) {
    throw new Error(`Collection ${target.relation} does not exist.`)
  }
  const name = JSON.stringify(target.relation)
  const options = documentOr('options' in info ? info.options : undefined)
  if (info.type === 'view') {
    const { viewOn, pipeline, ...rest } = options
    const extra = Object.keys(rest).length > 0 ? `, ${json(rest)}` : ''
    return `db.createView(${name}, ${JSON.stringify(viewOn)}, ${json(pipeline ?? [])}${extra});`
  }
  const create = `db.createCollection(${name}${Object.keys(options).length > 0 ? `, ${json(options)}` : ''});`
  const indexes = await db.collection(target.relation).listIndexes().toArray()
  const statements = indexes
    .filter((index) => index.name !== '_id_')
    .map((index) => {
      const { v: _version, key, ns: _namespace, ...rest } = index
      return `db.getCollection(${name}).createIndex(${json(key)}, ${json(rest)});`
    })
  return [create, ...statements].join('\n\n')
}
