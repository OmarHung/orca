import type {
  DatabaseDumpObject,
  DatabaseDumpOptions,
  DatabaseDumpRequest
} from '../../../../../shared/database/database-dump-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget,
  DatabaseRelationInfo,
  DatabaseRoutineInfo
} from '../../../../../shared/database/database-introspection-types'
import { asDatabaseResult } from '../database-connections-store'
import type { DatabaseDumpScope } from './database-jobs-store'

/** One object the dump dialog offers; `icon` follows the explorer's. */
export type DumpCandidate = {
  key: string
  object: DatabaseDumpObject
  icon: 'table' | 'view' | 'function' | 'procedure'
}

export type DumpCandidateGroup = { schema: string; candidates: DumpCandidate[] }

export function dumpCandidateKey(object: DatabaseDumpObject): string {
  const name = object.kind === 'routine' ? object.identity : object.name
  return JSON.stringify([object.kind, object.schema, name])
}

function relationCandidate(
  schema: string,
  relation: DatabaseRelationInfo,
  dataOnly: boolean
): DumpCandidate | null {
  switch (relation.kind) {
    case 'table':
    case 'partitioned-table': {
      const object = { kind: 'table' as const, schema, name: relation.name }
      return { key: dumpCandidateKey(object), object, icon: 'table' }
    }
    case 'view':
    case 'materialized-view': {
      if (dataOnly) {
        return null
      }
      const object = { kind: 'view' as const, schema, name: relation.name }
      return { key: dumpCandidateKey(object), object, icon: 'view' }
    }
    // A foreign table's rows live on another server; its data isn't this database's to dump.
    case 'foreign-table':
      return null
  }
}

function routineCandidate(schema: string, routine: DatabaseRoutineInfo): DumpCandidate {
  const object = {
    kind: 'routine' as const,
    schema,
    name: routine.name,
    identity: routine.identity,
    routineKind: routine.kind
  }
  return { key: dumpCandidateKey(object), object, icon: routine.kind }
}

async function introspect(
  connectionId: string,
  target: DatabaseIntrospectTarget
): Promise<DatabaseIntrospectResult> {
  const result = asDatabaseResult(await window.api.database.introspect(connectionId, target))
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.value
}

/** What the scope holds, schema by schema; routines only when the dump writes structure. */
export async function loadDumpCandidates(scope: DatabaseDumpScope): Promise<DumpCandidateGroup[]> {
  const inDatabase = scope.database === null ? {} : { database: scope.database }
  const schemas =
    scope.schema !== null
      ? [scope.schema]
      : await introspect(scope.connectionId, { level: 'schemas', ...inDatabase }).then((result) =>
          result.level === 'schemas' ? result.schemas.map((schema) => schema.name) : []
        )
  const groups: DumpCandidateGroup[] = []
  for (const schema of schemas) {
    const relations = await introspect(scope.connectionId, {
      level: 'relations',
      schema,
      ...inDatabase
    })
    const routines = scope.dataOnly
      ? null
      : await introspect(scope.connectionId, { level: 'routines', schema, ...inDatabase })
    const candidates = [
      ...(relations.level === 'relations' ? relations.relations : []).flatMap(
        (relation) => relationCandidate(schema, relation, scope.dataOnly) ?? []
      ),
      ...(routines?.level === 'routines' ? routines.routines : []).map((routine) =>
        routineCandidate(schema, routine)
      )
    ]
    if (candidates.length > 0) {
      groups.push({ schema, candidates })
    }
  }
  return groups
}

/** Everything listed, or just the object the dialog was opened on. */
export function initialDumpSelection(
  groups: readonly DumpCandidateGroup[],
  only: DatabaseDumpScope['only']
): ReadonlySet<string> {
  const all = groups.flatMap((group) => group.candidates)
  const picked = only
    ? all.filter(
        (candidate) =>
          candidate.object.kind !== 'routine' &&
          candidate.object.schema === only.schema &&
          candidate.object.name === only.name
      )
    : all
  return new Set(picked.map((candidate) => candidate.key))
}

export function buildDumpRequest(
  scope: DatabaseDumpScope,
  groups: readonly DumpCandidateGroup[],
  selected: ReadonlySet<string>,
  options: DatabaseDumpOptions
): DatabaseDumpRequest {
  const objects = groups
    .flatMap((group) => group.candidates)
    .filter((candidate) => selected.has(candidate.key))
    .map((candidate) => candidate.object)
  return { ...(scope.database === null ? {} : { database: scope.database }), objects, options }
}

/** e.g. `sales-2026-09-28`, named after the narrowest thing the dialog was opened on. */
export function suggestedDumpName(scope: DatabaseDumpScope, now: Date): string {
  const base = scope.only?.name ?? scope.schema ?? scope.database ?? scope.label
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${base}${scope.dataOnly ? '-data' : ''}-${date}`
}
