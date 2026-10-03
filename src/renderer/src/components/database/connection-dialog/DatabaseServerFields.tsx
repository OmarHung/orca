import React from 'react'
import { translate } from '@/i18n/i18n'
import {
  DATABASE_SSL_MODES,
  SQLSERVER_SSL_MODES,
  type DatabasePasswordStorage
} from '../../../../../shared/database/database-connection-types'
import type { DatabaseEncryptionStatus } from '../../../../../shared/database/database-session-types'
import { useSshVpnStore } from '../../ssh-vpn/ssh-vpn-store'
import { NO_SSH_TUNNEL, type DatabaseConnectionFormState } from './database-connection-form-state'
import { SelectField, TextField } from './database-form-controls'
import { DatabaseSshTunnelField } from './DatabaseSshTunnelField'
import { DatabaseVpnField } from './DatabaseVpnField'
import { shownVpnProfileId } from './database-ssh-host-vpn'

type ServerFieldsProps = {
  form: DatabaseConnectionFormState
  invalid: ReadonlySet<keyof DatabaseConnectionFormState>
  hasSavedPassword: boolean
  encryption: DatabaseEncryptionStatus | null
  onChange: (patch: Partial<DatabaseConnectionFormState>) => void
  onAddSshHost: () => void
}

function storageOptions(
  canStore: boolean
): { value: DatabasePasswordStorage; label: string; disabled?: boolean }[] {
  return [
    {
      value: 'forever',
      label: translate('database.connectionForm.storeForever', 'Save securely'),
      disabled: !canStore
    },
    {
      value: 'session',
      label: translate('database.connectionForm.storeSession', 'Until Orca quits')
    },
    { value: 'never', label: translate('database.connectionForm.storeNever', 'Never') }
  ]
}

function PasswordFields({
  form,
  hasSavedPassword,
  encryption,
  onChange
}: Omit<ServerFieldsProps, 'invalid'>): React.JSX.Element {
  const canStore = encryption?.canStorePasswords ?? true
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
      <SelectField
        label={translate('database.connectionForm.savePassword', 'Save password')}
        value={form.passwordStorage}
        options={storageOptions(canStore)}
        onChange={(passwordStorage) => onChange({ passwordStorage })}
      />
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

export function DatabaseServerFields(props: ServerFieldsProps): React.JSX.Element {
  const { form, invalid, onChange, onAddSshHost } = props
  const sslModes = form.driver === 'sqlserver' ? SQLSERVER_SSL_MODES : DATABASE_SSL_MODES
  const sshVpnAssignments = useSshVpnStore((state) => state.assignments)
  const viaSshTunnel = form.sshTargetId !== NO_SSH_TUNNEL
  return (
    <>
      <div className="grid grid-cols-2 items-start gap-3">
        <DatabaseSshTunnelField
          value={form.sshTargetId}
          onChange={(sshTargetId) => onChange({ sshTargetId })}
          onAddSshHost={onAddSshHost}
        />
        <DatabaseVpnField
          value={shownVpnProfileId(form, sshVpnAssignments)}
          viaSshTunnel={viaSshTunnel}
          onChange={(profileId) =>
            onChange(
              viaSshTunnel
                ? { sshHostVpn: { targetId: form.sshTargetId, profileId } }
                : { vpnProfileId: profileId }
            )
          }
        />
      </div>
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
          placeholder={translate('database.connectionForm.allDatabases', 'All databases')}
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
      <PasswordFields {...props} />
      <div className="grid grid-cols-2 items-end gap-3">
        <SelectField
          label={translate('database.connectionForm.ssl', 'SSL mode')}
          value={form.sslMode}
          options={sslModes.map((mode) => ({ value: mode, label: mode }))}
          onChange={(sslMode) => onChange({ sslMode })}
        />
      </div>
    </>
  )
}
