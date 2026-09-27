import type {
  DatabaseColumnInfo,
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget,
  DatabaseRelationInfo,
  DatabaseSchemaInfo
} from '../../../../../shared/database/database-introspection-types'
import { asDatabaseResult, useDatabaseConnectionsStore } from '../database-connections-store'

/** What completion reads about a database; every call resolves, with nothing on failure. */
export type SqlCatalog = {
  schemas: () => Promise<DatabaseSchemaInfo[]>
  relations: (schema: string) => Promise<DatabaseRelationInfo[]>
  columns: (schema: string, relation: string) => Promise<DatabaseColumnInfo[]>
}

// Keyed by connection, then by introspect target; failed loads are dropped so they retry.
const cache = new Map<string, Map<string, Promise<DatabaseIntrospectResult | null>>>()

async function introspect(
  connectionId: string,
  target: DatabaseIntrospectTarget
): Promise<DatabaseIntrospectResult | null> {
  const key = JSON.stringify(target)
  const entries = cache.get(connectionId) ?? new Map()
  cache.set(connectionId, entries)
  const cached = entries.get(key)
  if (cached) {
    return cached
  }
  const pending = window.api.database
    .introspect(connectionId, target)
    .then((response) => {
      const result = asDatabaseResult(response)
      if (!result.ok) {
        entries.delete(key)
      }
      return result.ok ? result.value : null
    })
    .catch(() => {
      entries.delete(key)
      return null
    })
  entries.set(key, pending)
  return pending
}

/** A catalog that reads only while the connection is up; completion never connects. */
export function sqlCatalogFor(connectionId: string): SqlCatalog {
  const load = async (target: DatabaseIntrospectTarget) => {
    const session = useDatabaseConnectionsStore.getState().sessions[connectionId]
    return session?.state === 'connected' ? introspect(connectionId, target) : null
  }
  return {
    schemas: async () => {
      const result = await load({ level: 'schemas' })
      return result?.level === 'schemas' ? result.schemas : []
    },
    relations: async (schema) => {
      const result = await load({ level: 'relations', schema })
      return result?.level === 'relations' ? result.relations : []
    },
    columns: async (schema, relation) => {
      const result = await load({ level: 'columns', schema, relation })
      return result?.level === 'columns' ? result.columns : []
    }
  }
}

/** Forgets what completion knows about a connection, e.g. after DDL or a dropped session. */
export function invalidateSqlCatalog(connectionId: string): void {
  cache.delete(connectionId)
}
