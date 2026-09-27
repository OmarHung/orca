import type React from 'react'
import { DEFAULT_REPO_BADGE_COLOR, REPO_COLORS } from '../../../../shared/constants'
import { useDatabaseConnectionsStore } from './database-connections-store'

/** The repo badge palette minus its neutral gray, which wouldn't mark anything. */
export const DATABASE_CONNECTION_COLORS = REPO_COLORS.filter(
  (color) => color !== DEFAULT_REPO_BADGE_COLOR
)

export function useDatabaseConnectionColor(connectionId: string): string | null {
  return useDatabaseConnectionsStore(
    (state) => state.connections.find((entry) => entry.id === connectionId)?.color ?? null
  )
}

/** A faint wash of the connection's color, like DataGrip's colored consoles. */
export function connectionTintStyle(color: string | null): React.CSSProperties | undefined {
  return color ? { backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` } : undefined
}

/** A bar along a tab's top edge in the connection's color. */
export function connectionTabStyle(color: string | null): React.CSSProperties | undefined {
  return color ? { boxShadow: `inset 0 2px 0 ${color}` } : undefined
}
