import type { AbstractCursor, Document, FindOptions, MongoClient } from 'mongodb'
import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseExecuteResult,
  DatabaseQueryResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import { ConsoleSchema } from './console-schema'
import { DatabaseCancelledError } from './database-error-mapping'
import { documentOr, documentsIn } from './mongodb-documents'
import { parseMongoStatement, type MongoOperation } from './mongodb-shell-parser'
import { documentColumns, documentFieldRows, documentRow, mongoCellText } from './mongodb-values'
import { arrayRowReader, OpenResultPager, type RowReader } from './open-result-pager'

const column = (name: string, typeName = 'string'): DatabaseColumn => ({ name, typeName })
const FIELD_COLUMNS = [column('field'), column('value', 'mixed')]

async function readDocuments(
  cursor: AbstractCursor<Document>,
  count: number
): Promise<{ documents: Document[]; done: boolean }> {
  const documents: Document[] = []
  while (documents.length < count && (await cursor.hasNext())) {
    const next = await cursor.next()
    if (next) {
      documents.push(next)
    }
  }
  return { documents, done: !(await cursor.hasNext()) }
}

/** One console's own MongoDB client; `use` and the picker move it between databases. */
export class MongoConsole {
  private readonly pager = new OpenResultPager()
  private cancelled = false
  readonly schema: ConsoleSchema

  constructor(
    readonly client: MongoClient,
    private database: string,
    private readonly onLost: () => void
  ) {
    this.schema = new ConsoleSchema({
      apply: async (name) => {
        this.database = name
      },
      current: async () => this.database,
      mayChange: (statement) => /^\s*use\s/i.test(statement)
    })
  }

  async execute(statement: string, pageSize: number): Promise<DatabaseExecuteResult> {
    await this.pager.release()
    this.cancelled = false
    const startedAt = performance.now()
    const operation = parseMongoStatement(statement)
    try {
      return { results: await this.run(operation, pageSize, startedAt) }
    } catch (error) {
      throw this.cancelled ? new DatabaseCancelledError() : error
    }
  }

  fetch(resultId: string, pageSize: number): Promise<DatabaseRowsPage> {
    return this.pager.fetch(resultId, pageSize)
  }

  /** Stops the running command by closing the client; the console reconnects on its next run. */
  cancel(): void {
    this.cancelled = true
    this.onLost()
    void this.client.close(true).catch(() => undefined)
  }

  async close(): Promise<void> {
    await this.pager.release()
    await this.client.close().catch(() => undefined)
  }

  private db(database: string | undefined): ReturnType<MongoClient['db']> {
    return this.client.db(database ?? this.database)
  }

  private async rows(
    columns: DatabaseColumn[],
    rows: DatabaseCell[][],
    pageSize: number,
    startedAt: number
  ): Promise<DatabaseQueryResult[]> {
    return [await this.pager.start(columns, arrayRowReader(rows), pageSize, startedAt)]
  }

  private async documents(
    cursor: AbstractCursor<Document>,
    pageSize: number,
    startedAt: number
  ): Promise<DatabaseQueryResult[]> {
    let first: { documents: Document[]; done: boolean }
    try {
      first = await readDocuments(cursor, pageSize)
    } catch (error) {
      await cursor.close().catch(() => undefined)
      throw error
    }
    // Why the first page decides: the grid's columns are fixed once rows are shown.
    const columns = documentColumns(first.documents)
    const reader: RowReader = {
      read: async (count) => {
        const page = await readDocuments(cursor, count)
        return { rows: page.documents.map((doc) => documentRow(doc, columns)), done: page.done }
      },
      close: () => cursor.close()
    }
    const rows = first.documents.map((doc) => documentRow(doc, columns))
    return [await this.pager.hold(columns, { rows, done: first.done }, reader, startedAt)]
  }

  private fields(
    reply: Document,
    pageSize: number,
    startedAt: number
  ): Promise<DatabaseQueryResult[]> {
    const batch: unknown = reply.cursor?.firstBatch
    if (Array.isArray(batch)) {
      const documents = documentsIn(batch)
      const columns = documentColumns(documents)
      return this.rows(
        columns,
        documents.map((doc) => documentRow(doc, columns)),
        pageSize,
        startedAt
      )
    }
    return this.rows(FIELD_COLUMNS, documentFieldRows(reply), pageSize, startedAt)
  }

  private count(
    value: number,
    pageSize: number,
    startedAt: number
  ): Promise<DatabaseQueryResult[]> {
    return this.rows([column('count', 'int')], [[String(value)]], pageSize, startedAt)
  }

  private async run(
    operation: MongoOperation,
    pageSize: number,
    startedAt: number
  ): Promise<DatabaseQueryResult[]> {
    if ('collection' in operation) {
      return this.runOnCollection(operation, pageSize, startedAt)
    }
    switch (operation.kind) {
      case 'use':
        this.database = operation.database
        return [{ kind: 'command', command: 'USE', rowCount: null, durationMs: 0 }]
      case 'showDatabases': {
        const reply = await this.client
          .db('admin')
          .command({ listDatabases: 1, authorizedDatabases: true })
        const databases = documentsIn(reply.databases)
        const rows = databases.map((entry) => [
          mongoCellText(entry.name),
          mongoCellText(entry.sizeOnDisk),
          mongoCellText(entry.empty)
        ])
        const columns = [column('name'), column('sizeOnDisk', 'long'), column('empty', 'bool')]
        return this.rows(columns, rows, pageSize, startedAt)
      }
      case 'showCollections':
      case 'collectionNames': {
        const names = await this.db(operation.database)
          .listCollections({}, { nameOnly: true, authorizedCollections: true })
          .toArray()
        const rows = names
          .map((entry) => [entry.name])
          .sort(([left], [right]) => left.localeCompare(right))
        return this.rows([column('name')], rows, pageSize, startedAt)
      }
      case 'collectionInfos':
        return this.documents(
          this.db(operation.database).listCollections(operation.filter),
          pageSize,
          startedAt
        )
      case 'databaseStats':
        return this.fields(
          await this.db(operation.database).command({ dbStats: 1 }),
          pageSize,
          startedAt
        )
      case 'command': {
        const target = operation.admin ? this.client.db('admin') : this.db(operation.database)
        return this.fields(await target.command(operation.command), pageSize, startedAt)
      }
    }
  }

  private async runOnCollection(
    operation: Extract<MongoOperation, { collection: string }>,
    pageSize: number,
    startedAt: number
  ): Promise<DatabaseQueryResult[]> {
    const collection = this.db(operation.database).collection(operation.collection)
    switch (operation.kind) {
      case 'find': {
        const { skip, limit, ...options } = operation.options
        if (operation.count !== 'none') {
          const window = operation.count === 'window' ? { skip, limit } : {}
          return this.count(
            await collection.countDocuments(operation.filter, window),
            pageSize,
            startedAt
          )
        }
        const findOptions: FindOptions = { ...options, skip, limit, batchSize: pageSize }
        const cursor = collection.find(operation.filter, findOptions)
        if (operation.explain) {
          return this.fields(await cursor.explain(operation.explain), pageSize, startedAt)
        }
        return this.documents(cursor, pageSize, startedAt)
      }
      case 'aggregate': {
        const cursor = collection.aggregate(operation.pipeline, {
          ...operation.options,
          batchSize: pageSize
        })
        if (operation.explain) {
          return this.fields(await cursor.explain(operation.explain), pageSize, startedAt)
        }
        return this.documents(cursor, pageSize, startedAt)
      }
      case 'countDocuments':
        return this.count(
          await collection.countDocuments(operation.filter, operation.options),
          pageSize,
          startedAt
        )
      case 'estimatedCount':
        return this.count(await collection.estimatedDocumentCount(), pageSize, startedAt)
      case 'distinct': {
        const values = await collection.distinct(operation.field, operation.filter)
        return this.rows(
          [column(operation.field, 'mixed')],
          values.map((value) => [mongoCellText(value)]),
          pageSize,
          startedAt
        )
      }
      case 'indexes':
        return this.documents(collection.listIndexes(), pageSize, startedAt)
      case 'collectionStats': {
        const [stats] = await collection.aggregate([{ $collStats: { storageStats: {} } }]).toArray()
        return this.fields(documentOr(stats?.storageStats), pageSize, startedAt)
      }
    }
  }
}
