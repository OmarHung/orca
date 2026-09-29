import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { SshVpnCredentialRequest } from '../../../../shared/ssh-vpn-types'

function answer(request: SshVpnCredentialRequest, username: string, password: string | null): void {
  void window.api.sshVpn.answerCredentials({
    requestId: request.requestId,
    credentials: password === null ? null : { username: username.trim(), password }
  })
}

function LoginPrompt({
  request,
  onDone
}: {
  request: SshVpnCredentialRequest
  onDone: () => void
}): React.JSX.Element {
  const [username, setUsername] = useState(request.username)
  const [password, setPassword] = useState('')
  const canSubmit = username.trim() !== '' && password !== ''
  const cancel = (): void => {
    answer(request, username, null)
    onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="sm:max-w-sm" data-ssh-vpn-login-prompt>
        <DialogHeader>
          <DialogTitle>
            {translate('sshVpn.prompt.title', 'Log in to VPN "{{name}}"', {
              name: request.profileName
            })}
          </DialogTitle>
          <DialogDescription>
            {request.hostLabel
              ? translate('sshVpn.prompt.forHost', 'Connecting to {{host}} needs this VPN.', {
                  host: request.hostLabel
                })
              : translate('sshVpn.prompt.manual', 'This VPN asks for a username and password.')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSubmit) {
              answer(request, username, password)
              onDone()
            }
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="ssh-vpn-prompt-username">
              {translate('sshVpn.login.username', 'VPN username')}
            </Label>
            <Input
              id="ssh-vpn-prompt-username"
              autoComplete="off"
              value={username}
              autoFocus={request.username === ''}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ssh-vpn-prompt-password">
              {translate('sshVpn.login.password', 'VPN password')}
            </Label>
            <Input
              id="ssh-vpn-prompt-password"
              type="password"
              autoComplete="off"
              value={password}
              autoFocus={request.username !== ''}
              aria-invalid={request.error !== null}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {request.error ? <p className="text-xs text-destructive">{request.error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={cancel}>
              {translate('sshVpn.prompt.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit} data-ssh-vpn-login-submit>
              {translate('sshVpn.prompt.connect', 'Connect')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Mounted once at the app root: main asks here when a VPN login is not saved or was rejected. */
export function SshVpnLoginPromptHost(): React.JSX.Element | null {
  const [queue, setQueue] = useState<SshVpnCredentialRequest[]>([])

  useEffect(() => {
    if (!window.api?.sshVpn) {
      return
    }
    return window.api.sshVpn.onCredentialRequest((request) =>
      setQueue((current) => [...current, request])
    )
  }, [])

  const current = queue[0]
  return current ? (
    <LoginPrompt
      key={current.requestId}
      request={current}
      onDone={() => setQueue((pending) => pending.slice(1))}
    />
  ) : null
}
