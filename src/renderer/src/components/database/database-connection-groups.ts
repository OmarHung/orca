import type { DatabaseSessionState } from '../../../../shared/database/database-session-types'

type Groupable = { id: string; group?: string | null }

export type DatabaseConnectionGroup = { name: string; connectionIds: string[] }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Group names in the order the explorer shows them. */
export function databaseConnectionGroupNames(connections: readonly Groupable[]): string[] {
  const names = new Set(connections.flatMap((connection) => connection.group ?? []))
  return [...names].sort(collator.compare)
}

/** Groups by name, then the ungrouped connections, as in DataGrip; each keeps saved order. */
export function groupDatabaseConnections(connections: readonly Groupable[]): {
  groups: DatabaseConnectionGroup[]
  ungrouped: string[]
} {
  const groups = databaseConnectionGroupNames(connections).map((name) => ({
    name,
    connectionIds: connections
      .filter((connection) => connection.group === name)
      .map((connection) => connection.id)
  }))
  const ungrouped = connections
    .filter((connection) => !connection.group)
    .map((connection) => connection.id)
  return { groups, ungrouped }
}

/** A typed group name as saved: trimmed, with blank meaning no group. */
export function normalizeDatabaseConnectionGroup(input: string): string | null {
  const name = input.trim()
  return name === '' ? null : name
}

/** A group's corner dot: connected wins, then connecting; failures show only on their own rows. */
export function groupSessionState(
  states: readonly (DatabaseSessionState | undefined)[]
): DatabaseSessionState {
  if (states.includes('connected')) {
    return 'connected'
  }
  return states.includes('connecting') ? 'connecting' : 'disconnected'
}
