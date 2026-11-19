import { BSON, type Db, type Document, type MongoClient } from 'mongodb'
import type {
  DatabaseObjectProperties,
  DatabasePropertiesTarget,
  DatabasePropertySection
} from '../../../shared/database/database-properties-types'
import { formatUptime, optionalRead, property } from './database-property-values'
import { sampledFields } from './mongodb-catalog'
import { documentOr, documentOrNull } from './mongodb-documents'

export type MongoPropertiesSource = {
  readonly client: MongoClient
  readonly serverVersion: string
  databaseNamed: (name: string | undefined) => Db
}

const json = (value: unknown): string | null =>
  value === undefined || value === null ? null : BSON.EJSON.stringify(value, { relaxed: true })

function topology(hello: Document): string {
  if (hello.msg === 'isdbgrid') {
    return 'sharded (mongos)'
  }
  if (typeof hello.setName === 'string') {
    const role =
      hello.isWritablePrimary === true
        ? 'primary'
        : hello.secondary === true
          ? 'secondary'
          : 'member'
    return `replica set ${hello.setName} (${role})`
  }
  return 'standalone'
}

async function serverSection(
  source: MongoPropertiesSource,
  notes: string[]
): Promise<DatabasePropertySection> {
  const admin = source.client.db('admin')
  const build = await admin.command({ buildInfo: 1 })
  const hello = await admin.command({ hello: 1 })
  const status = await optionalRead(notes, 'server status', () =>
    admin.command({ serverStatus: 1 })
  )
  const modules = Array.isArray(build.modules) ? build.modules : []
  const uptime = Number(status?.uptime)
  return {
    kind: 'server',
    name: null,
    properties: [
      ...property('version', source.serverVersion),
      ...property('edition', modules.includes('enterprise') ? 'Enterprise' : 'Community'),
      ...property('mode', topology(hello)),
      ...property('defaultEngine', status?.storageEngine?.name),
      ...property('uptime', Number.isFinite(uptime) ? formatUptime(uptime) : null)
    ]
  }
}

async function databaseSection(db: Db): Promise<DatabasePropertySection> {
  const stats = await db.command({ dbStats: 1 })
  return {
    kind: 'database',
    name: db.databaseName,
    properties: [
      ...property('collectionCount', stats.collections, 'count'),
      ...property('documentCount', stats.objects, 'count'),
      ...property('indexCount', stats.indexes, 'count'),
      ...property('dataSize', stats.dataSize, 'bytes'),
      ...property('indexSize', stats.indexSize, 'bytes'),
      ...property('size', stats.storageSize, 'bytes')
    ]
  }
}

async function collectionSection(
  db: Db,
  name: string,
  notes: string[]
): Promise<DatabasePropertySection> {
  const [info] = await db.listCollections({ name }).toArray()
  if (!info) {
    throw new Error(`Collection ${name} does not exist.`)
  }
  const options = documentOr('options' in info ? info.options : undefined)
  if (info.type === 'view') {
    return {
      kind: 'view',
      name,
      properties: [
        ...property('type', 'view'),
        ...property('viewOn', options.viewOn),
        ...property('pipeline', json(options.pipeline))
      ]
    }
  }
  const stats = await optionalRead(notes, 'storage statistics', async () => {
    const [entry] = await db
      .collection(name)
      .aggregate([{ $collStats: { storageStats: {} } }])
      .toArray()
    return documentOrNull(entry?.storageStats)
  })
  return {
    kind: 'collection',
    name,
    properties: [
      ...property('type', info.type ?? 'collection'),
      ...property('documentCount', stats?.count, 'count'),
      ...property('averageDocumentSize', stats?.avgObjSize, 'bytes'),
      ...property('dataSize', stats?.size, 'bytes'),
      ...property('size', stats?.storageSize, 'bytes'),
      ...property('indexCount', stats?.nindexes, 'count'),
      ...property('indexSize', stats?.totalIndexSize, 'bytes'),
      ...property('capped', options.capped === true, 'boolean'),
      ...property('validator', json(options.validator))
    ]
  }
}

export async function mongoProperties(
  source: MongoPropertiesSource,
  target: DatabasePropertiesTarget
): Promise<DatabaseObjectProperties> {
  const notes: string[] = []
  switch (target.kind) {
    case 'server':
      return { sections: [await serverSection(source, notes)], columns: null, notes }
    case 'database':
      return {
        sections: [await databaseSection(source.databaseNamed(target.database))],
        columns: null,
        notes
      }
    case 'schema':
      return {
        sections: [await databaseSection(source.databaseNamed(target.schema))],
        columns: null,
        notes
      }
    case 'relation': {
      const db = source.databaseNamed(target.schema)
      const section = await collectionSection(db, target.relation, notes)
      const fields = await optionalRead(notes, 'fields', () => sampledFields(db, target.relation))
      return {
        sections: [section],
        columns: (fields ?? []).map((field) => ({
          name: field.name,
          dataType: field.dataType,
          nullable: field.nullable,
          defaultValue: null,
          characterSet: null,
          collation: null,
          comment: null
        })),
        notes
      }
    }
  }
}
