import React from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DatabaseSessionState } from '../../../../shared/database/database-session-types'
import { useDatabaseConnectionsStore } from './database-connections-store'

export function describeSessionState(state: DatabaseSessionState): string {
  switch (state) {
    case 'connected':
      return translate('database.session.connected', 'Connected')
    case 'connecting':
      return translate('database.session.connecting', 'Connecting…')
    case 'error':
      return translate('database.session.error', 'Connection failed')
    case 'disconnected':
      return translate('database.session.disconnected', 'Not connected')
  }
}

function sessionDotClassName(state: DatabaseSessionState): string {
  return cn(
    'size-1.5 shrink-0 rounded-full bg-muted-foreground/40',
    state === 'connected' && 'bg-status-success',
    state === 'connecting' && 'animate-pulse bg-status-warning',
    state === 'error' && 'bg-destructive'
  )
}

export function DatabaseSessionDot({
  state,
  className
}: {
  state: DatabaseSessionState
  className?: string
}): React.JSX.Element {
  const label = describeSessionState(state)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('inline-block', sessionDotClassName(state), className)}
    />
  )
}

/**
 * An icon with the session state as a corner dot, as in DataGrip; disconnected shows none.
 * Decorative: pair it with DatabaseSessionStateText after the name, where the row reads it.
 */
export function DatabaseSessionIcon({
  state,
  title,
  children
}: {
  state: DatabaseSessionState
  title?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span aria-hidden title={title} className="relative flex shrink-0">
      {children}
      {state === 'disconnected' ? null : (
        // Why ring-background: it cuts the dot out of the icon's strokes beneath it.
        <span
          className={cn(
            'pointer-events-none absolute -right-0.5 -bottom-0.5 ring-1 ring-background',
            sessionDotClassName(state)
          )}
        />
      )}
    </span>
  )
}

/** The session state for assistive tech only, for rows whose icon shows it. */
export function DatabaseSessionStateText({
  state
}: {
  state: DatabaseSessionState
}): React.JSX.Element {
  return <span role="img" aria-label={describeSessionState(state)} className="sr-only" />
}

/** Connection name plus session state, for the console toolbar. */
export function DatabaseConnectionBadge({
  connectionId
}: {
  connectionId: string
}): React.JSX.Element {
  const connection = useDatabaseConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === connectionId)
  )
  const session = useDatabaseConnectionsStore((state) => state.sessions[connectionId])
  const sessionState = session?.state ?? 'disconnected'
  const title = [describeSessionState(sessionState), session?.serverVersion, session?.message]
    .filter(Boolean)
    .join(' · ')
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={title}>
      <DatabaseSessionDot state={sessionState} />
      <span className="max-w-60 truncate">
        {connection?.name ?? translate('database.connection.missing', 'Deleted connection')}
      </span>
    </span>
  )
}
