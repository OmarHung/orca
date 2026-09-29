import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  SSH_VPN_PASSWORD_STORAGE_MODES,
  type SshVpnPasswordStorage
} from '../../../../shared/ssh-vpn-types'

export type SshVpnLoginDraft = {
  username: string
  /** Empty keeps the saved password. */
  password: string
  passwordStorage: SshVpnPasswordStorage
}

function storageLabel(storage: SshVpnPasswordStorage): string {
  switch (storage) {
    case 'forever':
      return translate('sshVpn.login.storageForever', 'In the system keychain')
    case 'session':
      return translate('sshVpn.login.storageSession', 'Until Orca quits')
    case 'never':
      return translate('sshVpn.login.storageNever', 'Ask every time')
  }
}

function isSshVpnPasswordStorage(value: string): value is SshVpnPasswordStorage {
  return SSH_VPN_PASSWORD_STORAGE_MODES.some((mode) => mode === value)
}

/** Username, password and where to keep it, for profiles that ask for a login. */
export function SshVpnLoginFields({
  value,
  hasSavedPassword,
  canStorePasswords,
  onChange
}: {
  value: SshVpnLoginDraft
  hasSavedPassword: boolean
  canStorePasswords: boolean
  onChange: (next: SshVpnLoginDraft) => void
}): React.JSX.Element {
  return (
    <div className="space-y-3" data-ssh-vpn-login-fields>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="ssh-vpn-login-username">
            {translate('sshVpn.login.username', 'VPN username')}
          </Label>
          <Input
            id="ssh-vpn-login-username"
            autoComplete="off"
            value={value.username}
            aria-invalid={value.username.trim() === ''}
            onChange={(event) => onChange({ ...value, username: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ssh-vpn-login-password">
            {translate('sshVpn.login.password', 'VPN password')}
          </Label>
          <Input
            id="ssh-vpn-login-password"
            type="password"
            autoComplete="off"
            value={value.password}
            placeholder={
              hasSavedPassword
                ? translate('sshVpn.login.passwordSaved', 'Saved — type to replace')
                : translate('sshVpn.login.passwordAsk', 'Leave empty to be asked')
            }
            onChange={(event) => onChange({ ...value, password: event.target.value })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ssh-vpn-login-storage">
          {translate('sshVpn.login.storage', 'Keep the password')}
        </Label>
        <Select
          value={value.passwordStorage}
          onValueChange={(next) => {
            if (isSshVpnPasswordStorage(next)) {
              onChange({ ...value, passwordStorage: next })
            }
          }}
        >
          <SelectTrigger id="ssh-vpn-login-storage" size="sm" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SSH_VPN_PASSWORD_STORAGE_MODES.filter(
              (mode) => mode !== 'forever' || canStorePasswords
            ).map((mode) => (
              <SelectItem key={mode} value={mode}>
                {storageLabel(mode)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canStorePasswords ? null : (
          <p className="text-xs text-muted-foreground">
            {translate(
              'sshVpn.login.noKeychain',
              'This system has no secure password storage, so passwords are kept only until Orca quits.'
            )}
          </p>
        )}
      </div>
    </div>
  )
}
