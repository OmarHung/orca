import React, { useEffect, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { listsAllDatabases } from '../../../../../shared/database/database-connection-types'
import type { DatabaseSchemaInfo } from '../../../../../shared/database/database-introspection-types'
import { useDatabaseConnectionsStore } from '../database-connections-store'
import { useDatabasePageStore, type DatabaseConsoleTab } from '../database-page-store'
import { listDatabases, sqlCatalogFor } from './sql-completion-catalog'

type DatabaseSchemaSelectProps = {
  tab: DatabaseConsoleTab
  disabled: boolean
  /** Puts focus back in the console once a menu closes. */
  onMenuClosed: () => void
}

type ChoicesSource = { connectionId: string; database: string | null; kind: 'database' | 'schema' }

function useChoices(source: ChoicesSource | null): {
  choices: DatabaseSchemaInfo[]
  reload: () => void
} {
  const [choices, setChoices] = useState<DatabaseSchemaInfo[]>([])
  // Why reload on open: a database or schema created since the last look should be listed.
  const [generation, setGeneration] = useState(0)
  const connectionId = source?.connectionId
  const database = source?.database ?? null
  const kind = source?.kind
  useEffect(() => {
    if (!connectionId || !kind) {
      return
    }
    let current = true
    const load =
      kind === 'database'
        ? listDatabases(connectionId)
        : sqlCatalogFor(connectionId, database).schemas()
    void load.then((list) => current && setChoices(list))
    return () => {
      current = false
    }
  }, [connectionId, database, kind, generation])
  return { choices, reload: () => setGeneration((value) => value + 1) }
}

type PickerProps = {
  label: string
  placeholder: string
  picked: string | null
  choices: DatabaseSchemaInfo[]
  disabled: boolean
  onOpen: () => void
  onPick: (name: string) => void
  onMenuClosed: () => void
}

function Picker({
  label,
  placeholder,
  picked,
  choices,
  disabled,
  onOpen,
  onPick,
  onMenuClosed
}: PickerProps): React.JSX.Element {
  const shown = picked ?? choices.find((choice) => choice.isCurrent)?.name ?? ''
  // Before the list loads, the picked name still needs an item to show.
  const names =
    choices.some((choice) => choice.name === shown) || !shown
      ? choices.map((choice) => choice.name)
      : [shown, ...choices.map((choice) => choice.name)]
  return (
    <Select
      value={shown}
      disabled={disabled}
      onOpenChange={(open) => open && onOpen()}
      onValueChange={onPick}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue placeholder={placeholder} />
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

/**
 * DataGrip's switchers for where a console's names resolve. SQL Server switches database
 * (USE); MySQL's databases are its schemas (USE); PostgreSQL sets search_path, and when the
 * connection lists every database, also picks the database its session connects to.
 */
export function DatabaseSchemaSelect({
  tab,
  disabled,
  onMenuClosed
}: DatabaseSchemaSelectProps): React.JSX.Element | null {
  const connection = useDatabaseConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === tab.connectionId)
  )
  const connected = useDatabaseConnectionsStore(
    (state) => state.sessions[tab.connectionId]?.state === 'connected'
  )
  const setSchema = useDatabasePageStore((state) => state.setConsoleSchema)
  const setDatabase = useDatabasePageStore((state) => state.setConsoleDatabase)
  const driver = connection?.driver
  const showDatabase =
    driver === 'sqlserver' ||
    (driver === 'postgres' && connection !== undefined && listsAllDatabases(connection))
  const showSchema = driver === 'postgres' || driver === 'mysql'
  const databases = useChoices(
    connected && showDatabase
      ? { connectionId: tab.connectionId, database: null, kind: 'database' }
      : null
  )
  const schemas = useChoices(
    connected && showSchema
      ? { connectionId: tab.connectionId, database: tab.database, kind: 'schema' }
      : null
  )
  const databaseLabel = translate('database.console.database', 'Database')
  const chooseDatabase = translate('database.console.chooseDatabase', 'Choose database')
  return (
    <>
      {showDatabase ? (
        <Picker
          label={databaseLabel}
          placeholder={chooseDatabase}
          picked={tab.database}
          choices={databases.choices}
          disabled={disabled}
          onOpen={databases.reload}
          onPick={(name) => {
            setDatabase(tab.id, name)
            // Another PostgreSQL database has other schemas; start from its default.
            if (driver === 'postgres') {
              setSchema(tab.id, null)
            }
          }}
          onMenuClosed={onMenuClosed}
        />
      ) : null}
      {showSchema ? (
        <Picker
          label={
            driver === 'mysql' ? databaseLabel : translate('database.console.schema', 'Schema')
          }
          placeholder={
            driver === 'mysql'
              ? chooseDatabase
              : translate('database.console.chooseSchema', 'Choose schema')
          }
          picked={tab.schema}
          choices={schemas.choices}
          disabled={disabled}
          onOpen={schemas.reload}
          onPick={(name) => setSchema(tab.id, name)}
          onMenuClosed={onMenuClosed}
        />
      ) : null}
    </>
  )
}
