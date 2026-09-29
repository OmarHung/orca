import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import {
  DEFAULT_SSH_VPN_IDLE_MINUTES,
  MAX_SSH_VPN_IDLE_MINUTES,
  type SshVpnProfile
} from '../../../../shared/ssh-vpn-types'
import { sshVpnActions } from './ssh-vpn-store'

type SshVpnProfileFormProps = {
  /** Null to add a new profile. */
  profile: SshVpnProfile | null
  onDone: () => void
}

function parseIdleMinutes(value: string): number | null {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_SSH_VPN_IDLE_MINUTES
    ? minutes
    : null
}

export function SshVpnProfileForm({ profile, onDone }: SshVpnProfileFormProps): React.JSX.Element {
  const [name, setName] = useState(profile?.name ?? '')
  const [ovpnPath, setOvpnPath] = useState(profile?.ovpnPath ?? '')
  const [idle, setIdle] = useState(String(profile?.idleMinutes ?? DEFAULT_SSH_VPN_IDLE_MINUTES))
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const idleMinutes = parseIdleMinutes(idle)
  const canSave = name.trim() !== '' && ovpnPath.trim() !== '' && idleMinutes !== null && !isSaving

  const pickFile = async (): Promise<void> => {
    const picked = await sshVpnActions.pickOvpnFile()
    if (picked) {
      setOvpnPath(picked)
      if (!name.trim()) {
        setName(
          picked
            .split(/[\\/]/)
            .at(-1)
            ?.replace(/\.(ovpn|conf)$/i, '') ?? ''
        )
      }
    }
  }

  const save = async (): Promise<void> => {
    if (!canSave || idleMinutes === null) {
      return
    }
    setIsSaving(true)
    setError(null)
    const result = await sshVpnActions.saveProfile(profile?.id, {
      name: name.trim(),
      ovpnPath: ovpnPath.trim(),
      idleMinutes
    })
    setIsSaving(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    onDone()
  }

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      data-ssh-vpn-profile-form
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="ssh-vpn-profile-name">{translate('sshVpn.form.name', 'Name')}</Label>
        <Input
          id="ssh-vpn-profile-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={translate('sshVpn.form.namePlaceholder', 'Office VPN')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ssh-vpn-profile-path">
          {translate('sshVpn.form.ovpnPath', 'OpenVPN profile (.ovpn)')}
        </Label>
        <div className="flex gap-2">
          <Input
            id="ssh-vpn-profile-path"
            value={ovpnPath}
            onChange={(event) => setOvpnPath(event.target.value)}
            placeholder={translate('sshVpn.form.pathPlaceholder', '/path/to/office.ovpn')}
            aria-invalid={error !== null}
          />
          <Button type="button" variant="outline" onClick={() => void pickFile()}>
            {translate('sshVpn.form.browse', 'Choose…')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'sshVpn.form.ovpnHelp',
            'Certificate-only profiles are supported. Orca reads the file each time it connects and never copies it.'
          )}
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ssh-vpn-profile-idle">
          {translate('sshVpn.form.idle', 'Disconnect when idle (minutes)')}
        </Label>
        <Input
          id="ssh-vpn-profile-idle"
          type="number"
          min={0}
          max={MAX_SSH_VPN_IDLE_MINUTES}
          className="w-32"
          value={idle}
          onChange={(event) => setIdle(event.target.value)}
          aria-invalid={idleMinutes === null}
        />
        <p className="text-xs text-muted-foreground">
          {translate(
            'sshVpn.form.idleHelp',
            'Counted from when the last connection through this VPN closes. 0 keeps it connected until Orca quits.'
          )}
        </p>
      </div>
      {error ? <p className="text-sm break-all text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          {translate('sshVpn.form.cancel', 'Cancel')}
        </Button>
        <Button type="submit" className="w-20" disabled={!canSave}>
          {isSaving
            ? translate('sshVpn.form.checking', 'Checking…')
            : translate('sshVpn.form.save', 'Save')}
        </Button>
      </div>
    </form>
  )
}
