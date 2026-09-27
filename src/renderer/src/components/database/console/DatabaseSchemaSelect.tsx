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
import { listDatabases, sqlCatalogFor } from './sql-completion-catalog'

type DatabaseSchemaSelectProps = {
  tab: DatabaseConsoleTab
  disabled: boolean
  /** Puts focus back in the console once the menu closes. */
  onMenuClosed: () => void
}

// SQL Server switches database (the user's default schema applies inside it); MySQL's
// databases are its schemas, and PostgreSQL switches search_path.
type PickerKind = 'database' | 'schema'

function useChoices(
  connectionId: string,
  connected: boolean,
  kind: PickerKind | null
): { choices: DatabaseSchemaInfo[]; reload: () => void } {
  const [choices, setChoices] = useState<DatabaseSchemaInfo[]>([])
  // Why reload on open: a database or schema created since the last look should be listed.
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    if (!connected || kind === null) {
      return
    }
    let current = true
    const load =
      kind === 'database' ? listDatabases(connectionId) : sqlCatalogFor(connectionId).schemas()
    void load.then((list) => current && setChoices(list))
    return () => {
      current = false
    }
  }, [connectionId, connected, kind, generation])
  return { choices, reload: () => setGeneration((value) => value + 1) }
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
  const setDatabase = useDatabasePageStore((state) => state.setConsoleDatabase)
  const kind: PickerKind | null =
    driver === 'sqlserver'
      ? 'database'
      : driver === 'postgres' || driver === 'mysql'
        ? 'schema'
        : null
  const { choices: schemas, reload } = useChoices(tab.connectionId, connected, kind)
  if (kind === null) {
    return null
  }
  const picked = kind === 'database' ? tab.database : tab.schema
  const shown = picked ?? schemas.find((schema) => schema.isCurrent)?.name ?? ''
  // Before the list loads, the picked schema still needs an item to show.
  const names =
    schemas.some((schema) => schema.name === shown) || !shown
      ? schemas.map((schema) => schema.name)
      : [shown, ...schemas.map((schema) => schema.name)]
  const label =
    driver !== 'postgres'
      ? translate('database.console.database', 'Database')
      : translate('database.console.schema', 'Schema')
  return (
    <Select
      value={shown}
      disabled={disabled}
      onOpenChange={(open) => open && reload()}
      onValueChange={(name) =>
        kind === 'database' ? setDatabase(tab.id, name) : setSchema(tab.id, name)
      }
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue
          placeholder={
            driver !== 'postgres'
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
