import React from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'

type Props = {
  wrongPassphrase: boolean
  canRemember: boolean
  remember: boolean
  disabled: boolean
  onRememberChange: (remember: boolean) => void
}

export function SshPassphraseRememberControls({
  wrongPassphrase,
  canRemember,
  remember,
  disabled,
  onRememberChange
}: Props): React.JSX.Element | null {
  if (!wrongPassphrase && !canRemember) {
    return null
  }
  return (
    <div className="space-y-2">
      {wrongPassphrase ? (
        <p role="alert" className="text-xs text-destructive">
          {translate(
            'sshSavedPassphrases.dialog.wrongPassphrase',
            "That passphrase doesn't unlock this key."
          )}
        </p>
      ) : null}
      {canRemember ? (
        <div className="flex items-start gap-2">
          <Checkbox
            id="ssh-credential-remember"
            className="mt-0.5"
            checked={remember}
            disabled={disabled}
            onCheckedChange={(checked) => onRememberChange(checked === true)}
          />
          <div className="space-y-1">
            <Label htmlFor="ssh-credential-remember">
              {translate('sshSavedPassphrases.dialog.remember', 'Remember passphrase')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {translate(
                'sshSavedPassphrases.dialog.rememberHint',
                'Encrypted with the OS keychain. You can forget it in SSH settings.'
              )}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
