import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import {
  DEFAULT_SSH_VPN_IDLE_MINUTES,
  isAbsoluteOvpnPath,
  MAX_SSH_VPN_IDLE_MINUTES,
  type SshVpnProfile,
  type SshVpnProfileDraft
} from '../../../../shared/ssh-vpn-types'
import { SshVpnContainerField } from './SshVpnContainerField'
import { SshVpnLoginFields, type SshVpnLoginDraft } from './SshVpnLoginFields'
import { sshVpnActions, useSshVpnStore } from './ssh-vpn-store'

type SshVpnProfileFormProps = {
  /** Null to add a new profile. */
  profile: SshVpnProfile | null
  onDone: () => void
}

/** What the chosen .ovpn needs: unknown until inspected, then login or not, or why it can't work. */
type Inspection =
  | { state: 'unknown' }
  | { state: 'ready'; needsCredentials: boolean }
  | { state: 'error'; message: string }

type ProfileKind = 'ovpn' | 'container'

function isProfileKind(value: string): value is ProfileKind {
  return value === 'ovpn' || value === 'container'
}

function parseIdleMinutes(value: string): number | null {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_SSH_VPN_IDLE_MINUTES
    ? minutes
    : null
}

async function inspectOvpnPath(filePath: string): Promise<Inspection> {
  if (!isAbsoluteOvpnPath(filePath.trim())) {
    return { state: 'unknown' }
  }
  const result = await sshVpnActions.inspectOvpn(filePath.trim())
  return 'error' in result
    ? { state: 'error', message: result.error }
    : { state: 'ready', needsCredentials: result.inspection.needsCredentials }
}

function profileNameFromPath(filePath: string): string {
  return (
    filePath
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.(ovpn|conf)$/i, '') ?? ''
  )
}

export function SshVpnProfileForm({ profile, onDone }: SshVpnProfileFormProps): React.JSX.Element {
  const canStorePasswords = useSshVpnStore((state) => state.canStorePasswords)
  const hasSavedPassword = useSshVpnStore(
    (state) => profile !== null && state.savedPasswordProfileIds.includes(profile.id)
  )
  const ovpnProfile = profile?.kind === 'container' ? null : profile
  const [kind, setKind] = useState<ProfileKind>(profile?.kind ?? 'ovpn')
  const [name, setName] = useState(profile?.name ?? '')
  const [ovpnPath, setOvpnPath] = useState(ovpnProfile?.ovpnPath ?? '')
  const [containerName, setContainerName] = useState(
    profile?.kind === 'container' ? profile.containerName : ''
  )
  const [idle, setIdle] = useState(String(ovpnProfile?.idleMinutes ?? DEFAULT_SSH_VPN_IDLE_MINUTES))
  const [login, setLogin] = useState<SshVpnLoginDraft>({
    username: ovpnProfile?.username ?? '',
    password: '',
    passwordStorage: ovpnProfile?.passwordStorage ?? (canStorePasswords ? 'forever' : 'session')
  })
  const [inspection, setInspection] = useState<Inspection>({ state: 'unknown' })
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const idleMinutes = parseIdleMinutes(idle)
  const needsCredentials = inspection.state === 'ready' && inspection.needsCredentials
  const isSourceComplete =
    kind === 'container'
      ? containerName !== ''
      : ovpnPath.trim() !== '' &&
        idleMinutes !== null &&
        (!needsCredentials || login.username.trim() !== '')
  const canSave = name.trim() !== '' && isSourceComplete && !isSaving

  const inspect = async (filePath: string): Promise<void> => {
    setInspection(await inspectOvpnPath(filePath))
  }

  // Why only the saved path: edits inspect on pick or blur, not on every keystroke.
  const savedPath = ovpnProfile?.ovpnPath ?? null
  useEffect(() => {
    if (!savedPath) {
      return
    }
    let isCurrent = true
    void inspectOvpnPath(savedPath).then((result) => {
      if (isCurrent) {
        setInspection(result)
      }
    })
    return () => {
      isCurrent = false
    }
  }, [savedPath])

  const pickFile = async (): Promise<void> => {
    const picked = await sshVpnActions.pickOvpnFile()
    if (picked) {
      setOvpnPath(picked)
      if (!name.trim()) {
        setName(profileNameFromPath(picked))
      }
      await inspect(picked)
    }
  }

  const pickContainer = (picked: string): void => {
    setContainerName(picked)
    if (!name.trim()) {
      setName(picked)
    }
  }

  const draft = (): SshVpnProfileDraft | null => {
    if (kind === 'container') {
      return { kind, name: name.trim(), containerName }
    }
    if (idleMinutes === null) {
      return null
    }
    return {
      name: name.trim(),
      ovpnPath: ovpnPath.trim(),
      idleMinutes,
      ...(needsCredentials
        ? { username: login.username.trim(), passwordStorage: login.passwordStorage }
        : {})
    }
  }

  const save = async (): Promise<void> => {
    const next = canSave ? draft() : null
    if (!next) {
      return
    }
    setIsSaving(true)
    setError(null)
    const result = await sshVpnActions.saveProfile(
      profile?.id,
      next,
      kind === 'ovpn' && needsCredentials && login.password ? login.password : undefined
    )
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
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={kind}
        onValueChange={(value) => {
          if (isProfileKind(value)) {
            setKind(value)
          }
        }}
        aria-label={translate('sshVpn.form.kind', 'How this VPN connects')}
      >
        <ToggleGroupItem value="ovpn">
          {translate('sshVpn.form.kindOvpn', 'OpenVPN profile (.ovpn)')}
        </ToggleGroupItem>
        <ToggleGroupItem value="container">
          {translate('sshVpn.form.kindContainer', 'Container I already run')}
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="space-y-1">
        <Label htmlFor="ssh-vpn-profile-name">{translate('sshVpn.form.name', 'Name')}</Label>
        <Input
          id="ssh-vpn-profile-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={translate('sshVpn.form.namePlaceholder', 'Office VPN')}
        />
      </div>
      {kind === 'container' ? (
        <SshVpnContainerField value={containerName} onChange={pickContainer} />
      ) : (
        <>
          <div className="space-y-1">
            <Label htmlFor="ssh-vpn-profile-path">
              {translate('sshVpn.form.ovpnPath', 'OpenVPN profile (.ovpn)')}
            </Label>
            <div className="flex gap-2">
              <Input
                id="ssh-vpn-profile-path"
                value={ovpnPath}
                onChange={(event) => setOvpnPath(event.target.value)}
                onBlur={() => void inspect(ovpnPath)}
                placeholder={translate('sshVpn.form.pathPlaceholder', '/path/to/office.ovpn')}
                aria-invalid={inspection.state === 'error' || error !== null}
              />
              <Button type="button" variant="outline" onClick={() => void pickFile()}>
                {translate('sshVpn.form.browse', 'Choose…')}
              </Button>
            </div>
            {inspection.state === 'error' ? (
              <p className="text-xs break-all text-destructive">{inspection.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'sshVpn.form.ovpnHelp',
                  'Orca reads the file each time it connects and never copies it. Profiles that need one-time codes (MFA) are not supported yet.'
                )}
              </p>
            )}
          </div>
          {needsCredentials ? (
            <SshVpnLoginFields
              value={login}
              hasSavedPassword={hasSavedPassword}
              canStorePasswords={canStorePasswords}
              onChange={setLogin}
            />
          ) : null}
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
        </>
      )}
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
