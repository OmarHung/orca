import React from 'react'
import { translate } from '@/i18n/i18n'
import {
  DATABASE_DRIVERS,
  DATABASE_DRIVER_NAMES,
  type DatabaseDriver
} from '../../../../../shared/database/database-connection-types'
import type { DatabaseEncryptionStatus } from '../../../../../shared/database/database-session-types'
import { DatabaseConnectionColorField } from './DatabaseConnectionColorField'
import { DatabaseServerFields } from './DatabaseServerFields'
import { DatabaseSqliteFields } from './DatabaseSqliteFields'
import {
  defaultConnectionName,
  type DatabaseConnectionFormState
} from './database-connection-form-state'
import { SelectField, TextField } from './database-form-controls'

type FormProps = {
  form: DatabaseConnectionFormState
  invalid: ReadonlySet<keyof DatabaseConnectionFormState>
  hasSavedPassword: boolean
  encryption: DatabaseEncryptionStatus | null
  /** Editing keeps the driver fixed: its saved password and consoles belong to it. */
  driverLocked: boolean
  onDriverChange: (driver: DatabaseDriver) => void
  onChange: (patch: Partial<DatabaseConnectionFormState>) => void
}

export function DatabaseConnectionForm(props: FormProps): React.JSX.Element {
  const { form, invalid, driverLocked, onDriverChange, onChange } = props
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[11rem_1fr] gap-3">
        <SelectField
          label={translate('database.connectionForm.driver', 'Type')}
          value={form.driver}
          disabled={driverLocked}
          options={DATABASE_DRIVERS.map((driver) => ({
            value: driver,
            label: DATABASE_DRIVER_NAMES[driver]
          }))}
          onChange={onDriverChange}
        />
        <TextField
          label={translate('database.connectionForm.name', 'Name')}
          value={form.name}
          placeholder={defaultConnectionName(form)}
          aria-invalid={invalid.has('name')}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>
      {form.driver === 'sqlite' ? (
        <DatabaseSqliteFields form={form} invalid={invalid} onChange={onChange} />
      ) : (
        <DatabaseServerFields {...props} />
      )}
      <DatabaseConnectionColorField value={form.color} onChange={(color) => onChange({ color })} />
    </div>
  )
}
