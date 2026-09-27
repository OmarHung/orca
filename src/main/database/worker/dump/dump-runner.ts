import type {
  DatabaseDumpObject,
  DatabaseDumpProgress,
  DatabaseDumpRequest,
  DatabaseDumpSummary
} from '../../../../shared/database/database-dump-types'
import { orderTables, orderViews, tableKey } from './dump-order'
import { insertStatement, type DumpOutput } from './dump-output'
import type {
  DumpSource,
  DumpTableInfo,
  DumpTableStructure,
  DumpViewDefinition
} from './dump-source'
import { DumpCancelled, DumpWriter } from './dump-writer'

type Routine = Extract<DatabaseDumpObject, { kind: 'routine' }>
type View = Extract<DatabaseDumpObject, { kind: 'view' }> & DumpViewDefinition

export type DumpRun = {
  source: DumpSource
  request: DatabaseDumpRequest
  output: DumpOutput
  onProgress: (progress: DatabaseDumpProgress) => void
  isCancelled: () => boolean
}

type Plan = {
  order: DumpTableInfo[]
  structures: Map<string, DumpTableStructure>
  views: View[]
  routines: Routine[]
  foreignKeyChecksOff: boolean
}

async function planDump(
  source: DumpSource,
  request: DatabaseDumpRequest,
  writer: DumpWriter
): Promise<Plan> {
  const { options, objects } = request
  const structure = options.contents !== 'data'
  const infos: DumpTableInfo[] = []
  for (const table of objects.filter((object) => object.kind === 'table')) {
    writer.checkCancelled()
    infos.push(await source.tableInfo(table))
  }
  const { order, cyclic } = orderTables(infos)
  const defersForeignKeys = source.dialect === 'postgres' || source.dialect === 'sqlserver'
  const separateForeignKeys =
    structure && defersForeignKeys && (options.disableForeignKeys || cyclic.size > 0)
  if (cyclic.size > 0 && !options.disableForeignKeys) {
    source.notes.push(
      'Some tables reference each other in a cycle, so the dump loads them with foreign keys deferred or checks off.'
    )
  }
  const structures = new Map<string, DumpTableStructure>()
  const views: View[] = []
  if (structure) {
    for (const table of order) {
      writer.checkCancelled()
      structures.set(tableKey(table), await source.tableStructure(table, separateForeignKeys))
    }
    for (const view of objects.filter((object) => object.kind === 'view')) {
      writer.checkCancelled()
      views.push({ ...view, ...(await source.view(view)) })
    }
  }
  return {
    order,
    structures,
    views: orderViews(views),
    routines: structure
      ? objects.filter((object): object is Routine => object.kind === 'routine')
      : [],
    // Why also for a cycle: MySQL can't create a table whose foreign key names a missing one.
    foreignKeyChecksOff: options.disableForeignKeys || (structure && cyclic.size > 0)
  }
}

async function writeSetup(
  source: DumpSource,
  request: DatabaseDumpRequest,
  writer: DumpWriter,
  plan: Plan
): Promise<void> {
  const schemaCount = new Set(request.objects.map((object) => object.schema)).size
  for (const schema of new Set(request.objects.map((object) => object.schema))) {
    await writer.statements(source.createSchema(schema, schemaCount))
  }
  if (request.options.dropExisting) {
    for (const view of plan.views.toReversed()) {
      await writer.enter(view.schema)
      await writer.statements([view.drop])
    }
    for (const routine of plan.routines) {
      await writer.enter(routine.schema)
      await writer.statements([(await source.routine(routine)).drop])
    }
    await writer.statements(source.dropTables(plan.order.toReversed()))
  }
  const seen = new Set<string>()
  for (const table of plan.order) {
    await writer.enter(table.schema)
    const requires = plan.structures.get(tableKey(table))!.requires
    await writer.statements(requires.filter((statement) => !seen.has(statement.sql)))
    requires.forEach((statement) => seen.add(statement.sql))
  }
}

async function writeRows(
  source: DumpSource,
  writer: DumpWriter,
  table: DumpTableInfo,
  rowsPerInsert: number
): Promise<void> {
  writer.progress.currentTable = `${table.schema}.${table.name}`
  await writer.statements(source.beforeRows(table))
  const overridingSystemValue = source.dialect === 'postgres' && table.explicitIdentity
  for await (const batch of source.rows(table, rowsPerInsert)) {
    writer.checkCancelled()
    await writer.statements([
      { sql: insertStatement(table.sqlName, table.columns, batch, { overridingSystemValue }) }
    ])
    writer.progress.rows += batch.length
    writer.report(false)
  }
  await writer.statements(await source.afterRows(table))
}

async function writeFinish(source: DumpSource, writer: DumpWriter, plan: Plan): Promise<void> {
  const structureOf = (table: DumpTableInfo) => plan.structures.get(tableKey(table))!
  for (const table of plan.order) {
    await writer.enter(table.schema)
    await writer.statements(structureOf(table).foreignKeys)
  }
  for (const view of plan.views) {
    await writer.enter(view.schema)
    await writer.statements(view.create)
  }
  for (const routine of plan.routines) {
    writer.checkCancelled()
    await writer.enter(routine.schema)
    await writer.statements([(await source.routine(routine)).create])
  }
  for (const table of plan.order) {
    await writer.enter(table.schema)
    await writer.statements(structureOf(table).triggers)
  }
}

async function execute(
  run: DumpRun,
  writer: DumpWriter,
  startedAt: number
): Promise<DatabaseDumpSummary> {
  const { source, request } = run
  const { options } = request
  const structure = options.contents !== 'data'
  await source.begin()
  try {
    const plan = await planDump(source, request, writer)
    const settings = source.settings({
      foreignKeyChecksOff: plan.foreignKeyChecksOff,
      dataOnly: !structure
    })
    await writer.startFile('setup', settings)
    if (structure) {
      await writeSetup(source, request, writer, plan)
    }
    for (const table of plan.order) {
      writer.checkCancelled()
      await writer.startFile(`${table.schema}.${table.name}`, settings)
      await writer.section(`${table.schema}.${table.name}`)
      await writer.enter(table.schema)
      if (structure) {
        await writer.statements(plan.structures.get(tableKey(table))!.create)
      }
      if (options.contents !== 'structure') {
        await writeRows(source, writer, table, options.rowsPerInsert)
      }
      writer.progress.tablesDone += 1
      writer.report(true)
    }
    await writer.startFile('finish', settings)
    if (structure) {
      await writeFinish(source, writer, plan)
    }
  } finally {
    await source.end().catch(() => undefined)
  }
  const files = await writer.finish()
  return {
    cancelled: false,
    files,
    tables: writer.progress.tablesDone,
    rows: writer.progress.rows,
    bytes: run.output.bytes,
    durationMs: Date.now() - startedAt,
    notes: source.notes
  }
}

/** Runs a dump; a cancel or failure removes what was written, so no half dump looks whole. */
export async function runDump(run: DumpRun): Promise<DatabaseDumpSummary> {
  const startedAt = Date.now()
  const writer = new DumpWriter(run.source, run.output, {
    perTable: run.request.options.layout === 'file-per-table',
    tableCount: run.request.objects.filter((object) => object.kind === 'table').length,
    schemaCount: new Set(run.request.objects.map((object) => object.schema)).size,
    onProgress: run.onProgress,
    isCancelled: run.isCancelled
  })
  try {
    return await execute(run, writer, startedAt)
  } catch (error) {
    await run.output.discard()
    // Why also isCancelled: a cancel that stops a read in flight surfaces as the driver's error.
    if (!(error instanceof DumpCancelled) && !run.isCancelled()) {
      throw error
    }
    return {
      cancelled: true,
      files: [],
      tables: 0,
      rows: 0,
      bytes: 0,
      durationMs: Date.now() - startedAt,
      notes: []
    }
  }
}
