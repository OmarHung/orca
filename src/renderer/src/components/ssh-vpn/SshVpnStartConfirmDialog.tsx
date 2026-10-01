import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type {
  SshVpnStartConfirmRequest,
  SshVpnStartPreview
} from '../../../../shared/ssh-vpn-types'
import { CommandList } from '../command-confirm/CommandList'
import { SshVpnStatusDot } from './SshVpnStatusDot'
import { stateOfProfile, useSshVpnStore, useSshVpnSync } from './ssh-vpn-store'

type PreviewState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'loaded'; preview: SshVpnStartPreview }

const LOADING: PreviewState = { status: 'loading' }

/** The asked-about VPN shows the request's own commands; any other picked VPN is asked of main. */
function useStartPreview(request: SshVpnStartConfirmRequest, profileId: string): PreviewState {
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({})
  const isAsked = profileId === request.profileId
  const isKnown = previews[profileId] !== undefined
  useEffect(() => {
    if (isAsked || isKnown) {
      return
    }
    const settle = (state: PreviewState): void =>
      setPreviews((current) => ({ ...current, [profileId]: state }))
    window.api.sshVpn.previewStart(profileId).then(
      (result) =>
        settle(
          result.ok
            ? { status: 'loaded', preview: result.value }
            : { status: 'failed', message: result.error.message }
        ),
      (error: unknown) =>
        settle({
          status: 'failed',
          message: error instanceof Error ? error.message : String(error)
        })
    )
  }, [profileId, isAsked, isKnown])
  if (isAsked) {
    return { status: 'loaded', preview: { kind: 'start', commands: request.commands } }
  }
  return previews[profileId] ?? LOADING
}

function VpnPicker({
  value,
  onChange
}: {
  value: string
  onChange: (profileId: string) => void
}): React.JSX.Element {
  const profiles = useSshVpnStore((state) => state.profiles)
  const states = useSshVpnStore((state) => state.states)
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="ssh-vpn-start-profile">{translate('sshVpn.confirm.profile', 'VPN')}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id="ssh-vpn-start-profile"
          size="sm"
          className="w-64"
          data-ssh-vpn-start-picker
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              <SshVpnStatusDot status={stateOfProfile(states, profile.id).status} />
              <span className="truncate">{profile.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function PreviewBody({ state }: { state: PreviewState }): React.JSX.Element {
  if (state.status === 'loading') {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('sshVpn.confirm.loading', 'Checking what this VPN needs…')}
      </p>
    )
  }
  if (state.status === 'failed') {
    return <p className="text-sm break-all text-destructive">{state.message}</p>
  }
  const { preview } = state
  if (preview.kind === 'start') {
    return <CommandList commands={preview.commands} />
  }
  return (
    <p className="text-sm text-muted-foreground">
      {preview.kind === 'ready'
        ? translate(
            'sshVpn.confirm.alreadyUp',
            'This VPN is already connected; nothing needs to run.'
          )
        : translate(
            'sshVpn.confirm.borrowedNote',
            'This VPN runs in the container {{name}}, which is started and stopped outside Orca. Orca only checks it and connects through it.',
            { name: preview.containerName }
          )}
    </p>
  )
}

/** Asks before a VPN starts, listing its commands; a host's connection may pick another VPN. */
export function SshVpnStartConfirmDialog({
  request,
  onDone
}: {
  request: SshVpnStartConfirmRequest
  onDone: () => void
}): React.JSX.Element {
  useSshVpnSync()
  const [profileId, setProfileId] = useState(request.profileId)
  const isSwitched = profileId !== request.profileId
  const pickedName = useSshVpnStore(
    (state) => state.profiles.find((profile) => profile.id === profileId)?.name
  )
  // Why: picking only makes sense among several VPNs, and once the list holds the asked-about one.
  const canPick = useSshVpnStore(
    (state) =>
      request.switchable &&
      state.profiles.length > 1 &&
      state.profiles.some((profile) => profile.id === request.profileId)
  )
  const preview = useStartPreview(request, profileId)
  const loaded = preview.status === 'loaded' ? preview.preview : null
  const startsVpn = loaded?.kind !== 'ready' && loaded?.kind !== 'borrowed'
  const name = isSwitched ? (pickedName ?? '') : request.profileName
  const confirmRef = useRef<HTMLButtonElement>(null)

  const answer = (approved: boolean): void => {
    const switchTo =
      approved && isSwitched && loaded
        ? { profileId, commands: loaded.kind === 'start' ? loaded.commands : [] }
        : undefined
    void window.api.sshVpn.answerStart({
      requestId: request.requestId,
      approved,
      ...(switchTo ? { switchTo } : {})
    })
    onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && answer(false)}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-2xl"
        data-command-confirm
        data-ssh-vpn-start-confirm
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          confirmRef.current?.focus()
        }}
      >
        <DialogHeader className="min-w-0">
          <DialogTitle>
            {startsVpn
              ? translate('sshVpn.confirm.title', 'Start VPN "{{name}}"?', { name })
              : translate('sshVpn.confirm.useTitle', 'Connect through VPN "{{name}}"?', { name })}
          </DialogTitle>
          <DialogDescription className="whitespace-pre-line break-all">
            {[
              request.hostLabel
                ? translate('sshVpn.confirm.forHost', 'Connecting to {{host}} needs this VPN.', {
                    host: request.hostLabel
                  })
                : translate('sshVpn.confirm.manual', 'You asked to connect this VPN.'),
              translate(
                'sshVpn.confirm.isolated',
                'It runs in a Docker container; the rest of this computer stays off the VPN.'
              )
            ].join('\n')}
          </DialogDescription>
        </DialogHeader>
        {canPick ? (
          <div className="flex flex-col gap-1">
            <VpnPicker value={profileId} onChange={setProfileId} />
            {isSwitched && request.hostLabel ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'sshVpn.confirm.switchNote',
                  'From now on {{host}} connects through this VPN.',
                  { host: request.hostLabel }
                )}
              </p>
            ) : null}
          </div>
        ) : null}
        <PreviewBody state={preview} />
        <p className="text-xs text-muted-foreground">
          {translate(
            'sshVpn.confirm.tunnelNote',
            'Each SSH connection then runs `docker exec -i <container> nc <host> <port>` to reach the host through the VPN.'
          )}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>
            {translate('commandConfirm.cancel', 'Cancel')}
          </Button>
          <Button
            ref={confirmRef}
            data-command-confirm-accept
            disabled={!loaded}
            onClick={() => answer(true)}
          >
            {startsVpn
              ? translate('sshVpn.confirm.start', 'Start VPN')
              : translate('sshVpn.confirm.connect', 'Connect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
