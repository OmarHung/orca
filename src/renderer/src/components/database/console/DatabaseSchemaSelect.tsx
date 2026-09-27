import React, { useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { DatabaseSchemaInfo } from '../../../../../shared/database/database-introspection-types'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import { useDatabasePageStore, type DatabaseConsoleTab } from '../database-page-store'
import { sqlCatalogFor } from './sql-completion-catalog'

type DatabaseSchemaSelectProps = {
  tab: DatabaseConsoleTab
  disabled: boolean
  /** Puts focus back in the console once the menu closes. */
  onMenuClosed: () => void
}

function useSchemas(connectionId: string, connected: boolean): DatabaseSchemaInfo[] {
  const [schemas, setSchemas] = useState<DatabaseSchemaInfo[]>([])
  useEffect(() => {
    if (!connected) {
      return
    }
    let current = true
    void sqlCatalogFor(connectionId)
      .schemas()
      .then((list) => current && setSchemas(list))
    return () => {
      current = false
    }
  }, [connectionId, connected])
  return schemas
}

/**
 * DataGrip's schema switcher: where the console's unqualified names resolve. MySQL switches
 * database with USE, PostgreSQL sets search_path; other drivers have no per-session switch.
 */
export function DatabaseSchemaSelect({
  tab,
  disabled,
  onMenuClosed
}: DatabaseSchemaSelectProps): React.JSX.Element | null {
  const driver = useDatabaseConnectionsStore(
    (state) => state.connections.find((entry) => entry.id === tab.connectionId)?.driver
  )
  const connected = useDatabaseConnectionsStore(
    (state) => state.sessions[tab.connectionId]?.state === 'connected'
  )
  const setSchema = useDatabasePageStore((state) => state.setConsoleSchema)
  const schemas = useSchemas(tab.connectionId, connected)
  if (driver !== 'postgres' && driver !== 'mysql') {
    return null
  }
  const shown = tab.schema ?? schemas.find((schema) => schema.isCurrent)?.name ?? ''
  // Before the list loads, the picked schema still needs an item to show.
  const names =
    schemas.some((schema) => schema.name === shown) || !shown
      ? schemas.map((schema) => schema.name)
      : [shown, ...schemas.map((schema) => schema.name)]
  const label =
    driver === 'mysql'
      ? translate('database.console.database', 'Database')
      : translate('database.console.schema', 'Schema')
  return (
    <Select value={shown} disabled={disabled} onValueChange={(name) => setSchema(tab.id, name)}>
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue
          placeholder={
            driver === 'mysql'
              ? translate('database.console.chooseDatabase', 'Choose database')
              : translate('database.console.chooseSchema', 'Choose schema')
          }
        />
      </SelectTrigger>
      <SelectContent
        // Why: returning focus to the trigger would take it from a console the user already clicked.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onMenuClosed()
        }}
      >
        {names.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
