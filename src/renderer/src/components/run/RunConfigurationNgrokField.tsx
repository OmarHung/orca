import React, { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type {
  CommandRunConfiguration,
  DebugRunConfiguration,
  RunConfigurationNgrok
} from '../../../../shared/run-configurations/run-configuration-definition'
import { FormField } from './RunConfigurationFormField'

type SharableConfiguration = CommandRunConfiguration | DebugRunConfiguration

function ngrokFromPortText(text: string): RunConfigurationNgrok {
  const port = Number(text.trim())
  return text.trim() && Number.isInteger(port) && port >= 1 && port <= 65_535 ? { port } : {}
}

function withNgrok<T extends SharableConfiguration>(
  configuration: T,
  ngrok: RunConfigurationNgrok | undefined
): T {
  if (ngrok) {
    return { ...configuration, ngrok }
  }
  const copy = { ...configuration }
  delete copy.ngrok
  return copy
}

/** Shares the session's port publicly with ngrok while it runs. */
export function RunConfigurationNgrokField({
  configuration,
  readOnly,
  onChange
}: {
  configuration: SharableConfiguration
  readOnly: boolean
  onChange: (configuration: SharableConfiguration) => void
}): React.JSX.Element {
  const id = useId()
  const enabled = configuration.ngrok !== undefined
  // Why local text: parsing on every keystroke would drop a half-typed port.
  const [portText, setPortText] = useState(() => configuration.ngrok?.port?.toString() ?? '')
  return (
    <FormField
      label={translate('run.configurations.form.ngrokLabel', 'ngrok')}
      description={translate(
        'run.configurations.form.ngrokHint',
        'Once the program listens, its port gets a public URL, which is copied for you; it stops when the run stops. Leave the port empty to share the lowest port it opens.'
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={enabled}
          disabled={readOnly}
          data-testid="run-configuration-ngrok"
          onCheckedChange={(checked) =>
            onChange(
              withNgrok(configuration, checked === true ? ngrokFromPortText(portText) : undefined)
            )
          }
        />
        <Label htmlFor={id}>
          {translate('run.configurations.form.ngrok', 'Share publicly with ngrok when it runs')}
        </Label>
      </div>
      {enabled ? (
        <Input
          value={portText}
          disabled={readOnly}
          inputMode="numeric"
          placeholder={translate('run.configurations.form.ngrokPort', 'Port (optional)')}
          aria-label={translate('run.configurations.form.ngrokPort', 'Port (optional)')}
          data-testid="run-configuration-ngrok-port"
          className="w-40"
          onChange={(event) => {
            setPortText(event.target.value)
            onChange(withNgrok(configuration, ngrokFromPortText(event.target.value)))
          }}
        />
      ) : null}
    </FormField>
  )
}
