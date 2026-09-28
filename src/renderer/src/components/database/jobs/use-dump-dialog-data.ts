import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { DatabaseDumpTool } from '../../../../../shared/database/database-dump-types'
import {
  asDatabaseResult,
  findDatabaseConnection,
  useDatabaseConnectionsStore
} from '../database-connections-store'
import {
  initialDumpSelection,
  loadDumpCandidates,
  type DumpCandidateGroup
} from './database-dump-candidates'
import type { DatabaseDumpScope } from './database-jobs-store'

/** The native tool a dump can run instead of Orca's own: none applies to SQLite or SQL Server. */
export type DumpToolChoice =
  | { kind: 'none' }
  | { kind: 'missing'; name: string }
  | { kind: 'found'; tool: DatabaseDumpTool }

export type DumpDialogData =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'loaded'
      groups: DumpCandidateGroup[]
      initial: ReadonlySet<string>
      tool: DumpToolChoice
    }

async function loadTool(connectionId: string): Promise<DumpToolChoice> {
  const driver = findDatabaseConnection(connectionId)?.driver
  if (driver !== 'postgres' && driver !== 'mysql') {
    return { kind: 'none' }
  }
  const name = driver === 'postgres' ? 'pg_dump' : 'mysqldump'
  const result = asDatabaseResult(await window.api.database.dumpTool(connectionId))
  // A failed lookup only takes the choice away; Orca's own dump still works.
  return result.ok && result.value
    ? { kind: 'found', tool: result.value }
    : { kind: 'missing', name }
}

/** Connects if needed, then lists what the scope holds and finds the native dump tool. */
export function useDumpDialogData(scope: DatabaseDumpScope): DumpDialogData {
  const [state, setState] = useState<DumpDialogData>({ status: 'loading' })
  useEffect(() => {
    let current = true
    const load = async (): Promise<void> => {
      const connected = await useDatabaseConnectionsStore.getState().connect(scope.connectionId)
      if (!connected) {
        const session = useDatabaseConnectionsStore.getState().sessions[scope.connectionId]
        throw new Error(
          session?.message ?? translate('database.dump.notConnected', 'Connect to list objects.')
        )
      }
      const [groups, tool] = await Promise.all([
        loadDumpCandidates(scope),
        loadTool(scope.connectionId)
      ])
      if (current) {
        setState({
          status: 'loaded',
          groups,
          initial: initialDumpSelection(groups, scope.only),
          tool
        })
      }
    }
    load().catch(
      (error: unknown) =>
        current &&
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
    )
    return () => {
      current = false
    }
  }, [scope])
  return state
}
