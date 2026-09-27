import React from 'react'
import { Lock } from 'lucide-react'
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
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full bg-muted-foreground/40',
        state === 'connected' && 'bg-status-success',
        state === 'connecting' && 'animate-pulse bg-status-warning',
        state === 'error' && 'bg-destructive',
        className
      )}
    />
  )
}

export function ReadOnlyIcon(): React.JSX.Element {
  const label = translate('database.connection.readOnly', 'Read-only')
  return (
    <Lock className="size-3 shrink-0 text-muted-foreground" role="img" aria-label={label}>
      <title>{label}</title>
    </Lock>
  )
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
      {connection?.readOnly ? <ReadOnlyIcon /> : null}
    </span>
  )
}
