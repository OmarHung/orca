import type {
  DatabaseDumpRequest,
  DatabaseDumpTool
} from '../../../../../shared/database/database-dump-types'
import type { DatabaseConnectionDraft } from '../../../../../shared/database/database-connection-types'
import type { RoutedConnection } from '../../database-connection-route'

export type NativeServerConnection = RoutedConnection<
  Extract<DatabaseConnectionDraft, { driver: 'postgres' | 'mysql' }>
>

/** What a native dump connects to: the connection as the worker dials it (tunnel included). */
export type NativeDumpTarget = {
  connection: NativeServerConnection
  password: string | null
  serverVersion: string
}

/** One run of the tool; a file per table is several runs, one file is usually one. */
export type NativeRun = {
  /** The file's name in a per-table dump, and what progress says is being written. */
  label: string
  args: string[]
  /** Written before the tool's output, e.g. `USE` when a dump holds several MySQL databases. */
  prelude: string
  /** Tables whose rows this run writes, for progress. */
  tables: number
}

export type NativeDumpPlan = {
  tool: DatabaseDumpTool
  env: NodeJS.ProcessEnv
  runs: NativeRun[]
  notes: string[]
  /**
   * For a tool that can't fall back from TLS by itself (mariadb-dump with SSL "prefer"): the
   * arguments to retry a run with when TLS fails before anything was written.
   */
  withoutTls: ((args: string[]) => string[]) | null
  /** Removes what the plan made, e.g. MySQL's option file holding the password. */
  cleanup: () => Promise<void>
}

export type NativePlanInput = {
  tool: DatabaseDumpTool
  target: NativeDumpTarget
  request: DatabaseDumpRequest
}

/** The request's objects grouped by schema, in the order they were given. */
export function objectsBySchema(
  request: DatabaseDumpRequest
): Map<string, DatabaseDumpRequest['objects']> {
  const groups = new Map<string, DatabaseDumpRequest['objects']>()
  for (const object of request.objects) {
    groups.set(object.schema, [...(groups.get(object.schema) ?? []), object])
  }
  return groups
}

export function perTableSnapshotNote(tool: DatabaseDumpTool): string {
  return `Each ${tool.kind} run reads its own snapshot, so with a file per table the tables are read at slightly different moments.`
}
