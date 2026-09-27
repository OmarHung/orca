import React from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import {
  POSTGRES_SSL_MODES,
  type DatabasePasswordStorage,
  type PostgresSslMode
} from '../../../../../shared/database/database-connection-types'
import type { DatabaseEncryptionStatus } from '../../../../../shared/database/database-session-types'
import { FormField } from '../../run/RunConfigurationFormField'
import {
  defaultConnectionName,
  type DatabaseConnectionFormState
} from './database-connection-form-state'

type FormProps = {
  form: DatabaseConnectionFormState
  invalid: ReadonlySet<keyof DatabaseConnectionFormState>
  hasSavedPassword: boolean
  encryption: DatabaseEncryptionStatus | null
  onChange: (patch: Partial<DatabaseConnectionFormState>) => void
}

function storageLabel(storage: DatabasePasswordStorage): string {
  switch (storage) {
    case 'forever':
      return translate('database.connectionForm.storeForever', 'Save securely')
    case 'session':
      return translate('database.connectionForm.storeSession', 'Until Orca quits')
    case 'never':
      return translate('database.connectionForm.storeNever', 'Never')
  }
}

/** Label + input, with the label also naming the input for assistive tech. */
function TextField({
  label,
  ...inputProps
}: { label: string } & React.ComponentProps<typeof Input>): React.JSX.Element {
  return (
    <FormField label={label}>
      <Input aria-label={label} {...inputProps} />
    </FormField>
  )
}

function PasswordFields({
  form,
  hasSavedPassword,
  encryption,
  onChange
}: Omit<FormProps, 'invalid'>): React.JSX.Element {
  const canStore = encryption?.canStorePasswords ?? true
  const storageFieldLabel = translate('database.connectionForm.savePassword', 'Save password')
  return (
    <div className="grid grid-cols-[1fr_11rem] gap-3">
      <TextField
        label={translate('database.connectionForm.password', 'Password')}
        type="password"
        autoComplete="off"
        value={form.password}
        placeholder={
          hasSavedPassword && !form.passwordEdited
            ? translate('database.connectionForm.passwordSaved', 'Saved — type to replace')
            : ''
        }
        onChange={(event) => onChange({ password: event.target.value, passwordEdited: true })}
      />
      <FormField label={storageFieldLabel}>
        <Select
          value={form.passwordStorage}
          onValueChange={(value: DatabasePasswordStorage) => onChange({ passwordStorage: value })}
        >
          <SelectTrigger className="w-full" aria-label={storageFieldLabel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['forever', 'session', 'never'] as const).map((storage) => (
              <SelectItem
                key={storage}
                value={storage}
                disabled={storage === 'forever' && !canStore}
              >
                {storageLabel(storage)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {!canStore || encryption?.protectionGap ? (
        <p className="col-span-2 text-[11px] text-muted-foreground">
          {encryption?.protectionGap ??
            translate(
              'database.connectionForm.noKeychain',
              'This system has no secure password storage, so passwords are kept only until Orca quits.'
            )}
        </p>
      ) : null}
    </div>
  )
}

export function DatabaseConnectionForm({
  form,
  invalid,
  hasSavedPassword,
  encryption,
  onChange
}: FormProps): React.JSX.Element {
  const sslFieldLabel = translate('database.connectionForm.ssl', 'SSL mode')
  return (
    <div className="space-y-3">
      <TextField
        label={translate('database.connectionForm.name', 'Name')}
        value={form.name}
        placeholder={defaultConnectionName(form)}
        aria-invalid={invalid.has('name')}
        onChange={(event) => onChange({ name: event.target.value })}
      />
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <TextField
          label={translate('database.connectionForm.host', 'Host')}
          value={form.host}
          aria-invalid={invalid.has('host')}
          onChange={(event) => onChange({ host: event.target.value })}
        />
        <TextField
          label={translate('database.connectionForm.port', 'Port')}
          inputMode="numeric"
          value={form.port}
          aria-invalid={invalid.has('port')}
          onChange={(event) => onChange({ port: event.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label={translate('database.connectionForm.database', 'Database')}
          value={form.database}
          aria-invalid={invalid.has('database')}
          onChange={(event) => onChange({ database: event.target.value })}
        />
        <TextField
          label={translate('database.connectionForm.user', 'User')}
          value={form.user}
          aria-invalid={invalid.has('user')}
          onChange={(event) => onChange({ user: event.target.value })}
        />
      </div>
      <PasswordFields
        form={form}
        hasSavedPassword={hasSavedPassword}
        encryption={encryption}
        onChange={onChange}
      />
      <div className="grid grid-cols-2 items-end gap-3">
        <FormField label={sslFieldLabel}>
          <Select
            value={form.sslMode}
            onValueChange={(value: PostgresSslMode) => onChange({ sslMode: value })}
          >
            <SelectTrigger className="w-full" aria-label={sslFieldLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POSTGRES_SSL_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <label className="flex h-9 items-center gap-2 text-sm">
          <Switch
            checked={form.readOnly}
            onCheckedChange={(checked) => onChange({ readOnly: checked })}
          />
          {translate('database.connectionForm.readOnly', 'Read-only')}
        </label>
      </div>
    </div>
  )
}
