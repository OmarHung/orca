import { createBrowserUuid } from '@/lib/browser-uuid'
import { DATABASE_CONNECTION_ID_PATTERN } from '../../../../shared/database/database-connection-types'
import { DATABASE_CONSOLE_ID_PATTERN } from '../../../../shared/database/database-session-types'

/** What the run store needs: a tab and the server session its statements run on. */
export type DatabaseRunTarget = { id: string; connectionId: string; consoleId: string }

type TabBase = DatabaseRunTarget & { title: string }

export type DatabaseConsoleTab = TabBase & { kind: 'console' }

export type DatabaseTableTab = TabBase & {
  kind: 'table'
  schema: string
  relation: string
  where: string
  orderBy: string
  /** A second session for COUNT(*), so counting never closes the data cursor. */
  countConsoleId: string
}

export type DatabaseTab = DatabaseConsoleTab | DatabaseTableTab

export function newConsoleTab(connectionId: string, title: string): DatabaseConsoleTab {
  return {
    kind: 'console',
    id: createBrowserUuid(),
    connectionId,
    consoleId: createBrowserUuid(),
    title
  }
}

export function newTableTab(
  connectionId: string,
  schema: string,
  relation: string
): DatabaseTableTab {
  return {
    kind: 'table',
    id: createBrowserUuid(),
    connectionId,
    consoleId: createBrowserUuid(),
    countConsoleId: createBrowserUuid(),
    title: relation,
    schema,
    relation,
    where: '',
    orderBy: ''
  }
}

/** Every server session a tab owns, so closing it can release them all. */
export function tabSessionIds(tab: DatabaseTab): string[] {
  return tab.kind === 'table' ? [tab.consoleId, tab.countConsoleId] : [tab.consoleId]
}

function field(value: object, key: string): unknown {
  return Reflect.get(value, key)
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && DATABASE_CONSOLE_ID_PATTERN.test(value)
}

/** Validates a persisted tab; tabs saved before table tabs existed have no `kind` and are consoles. */
export function readPersistedTab(value: unknown): DatabaseTab | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const id = field(value, 'id')
  const connectionId = field(value, 'connectionId')
  const consoleId = field(value, 'consoleId')
  const title = field(value, 'title')
  if (
    typeof id !== 'string' ||
    typeof connectionId !== 'string' ||
    !DATABASE_CONNECTION_ID_PATTERN.test(connectionId) ||
    !isSessionId(consoleId) ||
    typeof title !== 'string'
  ) {
    return null
  }
  if (field(value, 'kind') !== 'table') {
    return { kind: 'console', id, connectionId, consoleId, title }
  }
  const schema = field(value, 'schema')
  const relation = field(value, 'relation')
  const where = field(value, 'where')
  const orderBy = field(value, 'orderBy')
  const countConsoleId = field(value, 'countConsoleId')
  if (
    typeof schema !== 'string' ||
    typeof relation !== 'string' ||
    typeof where !== 'string' ||
    typeof orderBy !== 'string' ||
    !isSessionId(countConsoleId)
  ) {
    return null
  }
  return {
    kind: 'table',
    id,
    connectionId,
    consoleId,
    countConsoleId,
    title,
    schema,
    relation,
    where,
    orderBy
  }
}
