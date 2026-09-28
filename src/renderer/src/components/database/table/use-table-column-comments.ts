import { useEffect, useState } from 'react'
import { asDatabaseResult, useDatabaseConnectionsStore } from '../database-connections-store'
import type { DatabaseTableTab } from '../database-page-tabs'

const NONE: ReadonlyMap<string, string> = new Map()

/**
 * The table's column comments by column name, for the grid's header tooltips. Read again each
 * time the connection comes up; a failed read only leaves the headers without them.
 */
export function useTableColumnComments(tab: DatabaseTableTab): ReadonlyMap<string, string> {
  const { connectionId, database, schema, relation } = tab
  const connected = useDatabaseConnectionsStore(
    (state) => state.sessions[connectionId]?.state === 'connected'
  )
  const [comments, setComments] = useState(NONE)
  useEffect(() => {
    if (!connected) {
      return
    }
    let current = true
    void window.api.database
      .introspect(connectionId, {
        level: 'columns',
        ...(database === null ? {} : { database }),
        schema,
        relation
      })
      .then((response) => {
        const result = asDatabaseResult(response)
        if (current && result.ok && result.value.level === 'columns') {
          setComments(
            new Map(
              result.value.columns.flatMap((column): [string, string][] =>
                column.comment ? [[column.name, column.comment]] : []
              )
            )
          )
        }
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [connected, connectionId, database, schema, relation])
  return comments
}
