import type {
  DatabaseRelationInfo,
  DatabaseSchemaInfo
} from '../../../../../shared/database/database-introspection-types'
import type { SqlDialect } from '../../../../../shared/database/sql-dialect-lexing'
import { quoteSqlName } from '../../../../../shared/database/sql-identifiers'
import { splitSqlStatements } from '../../../../../shared/database/sql-statement-splitter'
import { completionSite, type TableReference } from './sql-completion-context'
import type { SqlCatalog } from './sql-completion-catalog'
import { sqlKeywords } from './sql-completion-keywords'

export type SqlCompletionKind = 'column' | 'table' | 'view' | 'schema' | 'keyword'

export type SqlCompletion = {
  label: string
  kind: SqlCompletionKind
  detail: string
  insertText: string
  sortText: string
}

type SqlCompletionRequest = {
  /** The whole console; completion reads only the statement around `offset`. */
  text: string
  offset: number
  dialect: SqlDialect
  catalog: SqlCatalog
}

// Columns first, then tables, schemas and keywords, as DataGrip lists them.
const GROUP: Record<SqlCompletionKind, number> = {
  column: 0,
  table: 1,
  view: 1,
  schema: 2,
  keyword: 3
}

/** Exact match first; unquoted names fold case, so a case-insensitive match comes next. */
function byName<T extends { name: string }>(items: readonly T[], name: string): T | undefined {
  const folded = name.toLowerCase()
  return (
    items.find((item) => item.name === name) ??
    items.find((item) => item.name.toLowerCase() === folded)
  )
}

function item(
  kind: SqlCompletionKind,
  label: string,
  detail: string,
  insertText: string,
  order: number
): SqlCompletion {
  const sortText = `${GROUP[kind]}-${String(order).padStart(5, '0')}`
  return { label, kind, detail, insertText, sortText }
}

type Resolver = {
  schemas: DatabaseSchemaInfo[]
  current: string | null
  request: SqlCompletionRequest
}

function resolveSchema(resolver: Resolver, name: string | null): string | null {
  return name === null ? resolver.current : (byName(resolver.schemas, name)?.name ?? name)
}

async function relationItems(resolver: Resolver, schema: string | null): Promise<SqlCompletion[]> {
  if (schema === null) {
    return []
  }
  const { catalog, dialect } = resolver.request
  const relations = await catalog.relations(schema)
  return relations.map((relation, index) =>
    item(
      relation.kind === 'view' || relation.kind === 'materialized-view' ? 'view' : 'table',
      relation.name,
      schema,
      quoteSqlName(relation.name, dialect),
      index
    )
  )
}

async function findRelation(
  resolver: Resolver,
  schemaName: string | null,
  name: string
): Promise<{ schema: string; relation: DatabaseRelationInfo } | null> {
  const schema = resolveSchema(resolver, schemaName)
  if (schema === null) {
    return null
  }
  const relation = byName(await resolver.request.catalog.relations(schema), name)
  return relation ? { schema, relation } : null
}

async function columnItems(
  resolver: Resolver,
  reference: TableReference
): Promise<SqlCompletion[]> {
  const found = await findRelation(resolver, reference.schema, reference.name)
  if (!found) {
    return []
  }
  const { catalog, dialect } = resolver.request
  const columns = await catalog.columns(found.schema, found.relation.name)
  return columns.map((column, index) =>
    item(
      'column',
      column.name,
      `${column.dataType} · ${found.relation.name}`,
      quoteSqlName(column.name, dialect),
      index
    )
  )
}

function keywordItems(dialect: SqlDialect, prefix: string): SqlCompletion[] {
  // Follow the case being typed, so `sel` completes to `select`.
  const lower = prefix !== '' && prefix === prefix.toLowerCase()
  return sqlKeywords(dialect).map((keyword, index) => {
    const text = lower ? keyword.toLowerCase() : keyword
    return item('keyword', text, '', text, index)
  })
}

async function memberItems(
  resolver: Resolver,
  qualifier: string,
  references: readonly TableReference[]
): Promise<SqlCompletion[]> {
  const folded = qualifier.toLowerCase()
  const reference =
    references.find((ref) => ref.alias?.toLowerCase() === folded) ??
    references.find((ref) => ref.name.toLowerCase() === folded)
  if (reference) {
    return columnItems(resolver, reference)
  }
  const schema = byName(resolver.schemas, qualifier)
  if (schema) {
    return relationItems(resolver, schema.name)
  }
  return columnItems(resolver, { schema: null, name: qualifier, alias: null })
}

/**
 * The statement the caret is typing in, from its start to its end (or the caret, when trailing
 * whitespace follows an unterminated statement); empty between statements.
 */
export function statementAtCaret(
  text: string,
  offset: number,
  dialect: SqlDialect
): { statement: string; offset: number } {
  const statement = splitSqlStatements(text, dialect).findLast(
    (candidate) =>
      candidate.start <= offset &&
      (candidate.terminatorEnd === candidate.end || offset < candidate.terminatorEnd)
  )
  if (!statement) {
    return { statement: '', offset: 0 }
  }
  return {
    statement: text.slice(statement.start, Math.max(statement.end, offset)),
    offset: offset - statement.start
  }
}

/** Suggestions for the caret at `offset`, and the word they replace. */
export async function sqlCompletions(
  request: SqlCompletionRequest
): Promise<{ prefix: string; items: SqlCompletion[] }> {
  const caret = statementAtCaret(request.text, request.offset, request.dialect)
  const { site, prefix, references } = completionSite(
    caret.statement,
    caret.offset,
    request.dialect
  )
  const schemas = await request.catalog.schemas()
  const resolver: Resolver = {
    schemas,
    current: schemas.find((schema) => schema.isCurrent)?.name ?? null,
    request
  }
  const schemaItems = schemas.map((schema, index) =>
    item('schema', schema.name, '', quoteSqlName(schema.name, request.dialect), index)
  )
  switch (site.kind) {
    case 'member':
      return { prefix, items: await memberItems(resolver, site.qualifier, references) }
    case 'relation': {
      const schema = site.schema === null ? resolver.current : resolveSchema(resolver, site.schema)
      const relations = await relationItems(resolver, schema)
      return { prefix, items: site.schema === null ? [...relations, ...schemaItems] : relations }
    }
    case 'any': {
      const [columns, relations] = await Promise.all([
        Promise.all(references.map((reference) => columnItems(resolver, reference))),
        relationItems(resolver, resolver.current)
      ])
      return {
        prefix,
        items: [...columns.flat(), ...relations, ...keywordItems(request.dialect, prefix)]
      }
    }
  }
}
