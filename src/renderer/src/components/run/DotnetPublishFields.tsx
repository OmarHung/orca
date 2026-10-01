import React, { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
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
  DEFAULT_PUBLISH_BUILD_CONFIGURATION,
  DOTNET_PUBLISH_RUNTIMES,
  dotnetPublishCommand,
  type DotnetPublishRunConfiguration
} from '../../../../shared/run-configurations/dotnet-publish-configuration'
import { FolderPathInput } from './FolderPathInput'
import { FormField } from './RunConfigurationFormField'

const PORTABLE = 'portable'
const BUILD_CONFIGURATIONS = ['Release', 'Debug']
type Flag = 'singleFile' | 'readyToRun' | 'trimmed'

type Props = {
  configuration: DotnetPublishRunConfiguration
  disabled: boolean
  /** The workspace root when its folders are on this machine, so Browse can pick one. */
  browseRoot: string | null
  onChange: (configuration: DotnetPublishRunConfiguration) => void
}

/** Keeps the current value selectable when orca.yaml names one outside the list. */
function withCurrent(options: readonly string[], current: string | undefined): string[] {
  return current && !options.includes(current) ? [...options, current] : [...options]
}

function SelectField({
  label,
  value,
  options,
  disabled,
  testId,
  onChange
}: {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  disabled: boolean
  testId: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <FormField label={label}>
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-full" data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

function FlagCheckbox({
  flag,
  label,
  configuration,
  disabled,
  onChange
}: {
  flag: Flag
  label: string
  configuration: DotnetPublishRunConfiguration
  disabled: boolean
  onChange: (configuration: DotnetPublishRunConfiguration) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={configuration[flag] === true && !disabled}
        disabled={disabled}
        data-testid={`dotnet-publish-${flag}`}
        onCheckedChange={(checked) => onChange({ ...configuration, [flag]: checked === true })}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
}

function TargetLocationField({
  configuration,
  disabled,
  browseRoot,
  onChange
}: Props): React.JSX.Element {
  return (
    <FormField
      label={translate('run.configurations.publish.targetLocation', 'Target location')}
      description={translate(
        'run.configurations.publish.targetLocationHint',
        'Relative to the workspace root, or absolute. Empty uses bin/<configuration>/<framework>/publish.'
      )}
    >
      <FolderPathInput
        value={configuration.outputDir ?? ''}
        disabled={disabled}
        browseRoot={browseRoot}
        placeholder="src/Api/bin/Release/net8.0/publish"
        testIdPrefix="dotnet-publish"
        onChange={(outputDir) => onChange({ ...configuration, outputDir })}
      />
    </FormField>
  )
}

function RuntimeFields({ configuration, disabled, onChange }: Props): React.JSX.Element {
  const runtimes = withCurrent(DOTNET_PUBLISH_RUNTIMES, configuration.runtime)
  return (
    <div className="grid grid-cols-2 gap-3">
      <SelectField
        label={translate('run.configurations.publish.runtime', 'Target runtime')}
        value={configuration.runtime ?? PORTABLE}
        options={[
          {
            value: PORTABLE,
            label: translate('run.configurations.publish.portable', 'Portable')
          },
          ...runtimes.map((runtime) => ({ value: runtime, label: runtime }))
        ]}
        disabled={disabled}
        testId="dotnet-publish-runtime"
        onChange={(value) =>
          onChange({ ...configuration, runtime: value === PORTABLE ? undefined : value })
        }
      />
      <SelectField
        label={translate('run.configurations.publish.deploymentMode', 'Deployment mode')}
        value={
          configuration.runtime && configuration.selfContained ? 'self-contained' : 'framework'
        }
        options={[
          {
            value: 'framework',
            label: translate('run.configurations.publish.frameworkDependent', 'Framework-dependent')
          },
          {
            value: 'self-contained',
            label: translate('run.configurations.publish.selfContained', 'Self-contained')
          }
        ]}
        disabled={disabled || !configuration.runtime}
        testId="dotnet-publish-deployment-mode"
        onChange={(value) =>
          onChange({ ...configuration, selfContained: value === 'self-contained' })
        }
      />
    </div>
  )
}

/** Rider's "Publish to folder" settings, with the exact command they produce. */
export function DotnetPublishFields(props: Props): React.JSX.Element {
  const { configuration, disabled, onChange } = props
  const needsRuntime = disabled || !configuration.runtime
  return (
    <>
      <FormField
        label={translate('run.configurations.form.projectFile', 'Project file')}
        description={translate(
          'run.configurations.publish.projectFileHint',
          'Relative to the workspace root, or absolute.'
        )}
      >
        <Input
          value={configuration.projectFile}
          disabled={disabled}
          placeholder="src/Api/Api.csproj"
          data-testid="dotnet-publish-project-file"
          onChange={(event) => onChange({ ...configuration, projectFile: event.target.value })}
        />
      </FormField>
      <TargetLocationField {...props} />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label={translate('run.configurations.publish.configuration', 'Configuration')}
          value={configuration.buildConfiguration ?? DEFAULT_PUBLISH_BUILD_CONFIGURATION}
          options={withCurrent(BUILD_CONFIGURATIONS, configuration.buildConfiguration).map(
            (name) => ({ value: name, label: name })
          )}
          disabled={disabled}
          testId="dotnet-publish-configuration"
          onChange={(buildConfiguration) => onChange({ ...configuration, buildConfiguration })}
        />
        <FormField label={translate('run.configurations.publish.framework', 'Target framework')}>
          <Input
            value={configuration.framework ?? ''}
            disabled={disabled}
            placeholder={translate('run.configurations.publish.projectDefault', 'Project default')}
            data-testid="dotnet-publish-framework"
            onChange={(event) => onChange({ ...configuration, framework: event.target.value })}
          />
        </FormField>
      </div>
      <RuntimeFields {...props} />
      <FormField
        label={translate('run.configurations.publish.fileOptions', 'File publish options')}
        description={translate(
          'run.configurations.publish.fileOptionsHint',
          'These need a target runtime; trimming also needs a self-contained app.'
        )}
      >
        <div className="space-y-2">
          <FlagCheckbox
            {...props}
            flag="singleFile"
            label={translate('run.configurations.publish.singleFile', 'Produce single file')}
            disabled={needsRuntime}
          />
          <FlagCheckbox
            {...props}
            flag="readyToRun"
            label={translate(
              'run.configurations.publish.readyToRun',
              'Enable ReadyToRun compilation'
            )}
            disabled={needsRuntime}
          />
          <FlagCheckbox
            {...props}
            flag="trimmed"
            label={translate('run.configurations.publish.trimmed', 'Trim unused code')}
            disabled={needsRuntime || !configuration.selfContained}
          />
        </div>
      </FormField>
      <FormField
        label={translate('run.configurations.publish.extraArgs', 'Additional arguments')}
        description={translate(
          'run.configurations.publish.extraArgsHint',
          'Appended to the command as written, e.g. -p:Version=1.2.3'
        )}
      >
        <Input
          value={configuration.extraArgs ?? ''}
          disabled={disabled}
          data-testid="dotnet-publish-extra-args"
          onChange={(event) => onChange({ ...configuration, extraArgs: event.target.value })}
        />
      </FormField>
      <FormField
        label={translate('run.configurations.publish.command', 'Runs from the workspace root')}
      >
        <p
          data-testid="dotnet-publish-command"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs leading-5 break-all select-text"
        >
          {dotnetPublishCommand(configuration) ??
            translate(
              'run.configurations.publish.unsafePath',
              'The project file or output folder contains characters that cannot be passed safely to a shell, such as " $ ` % or !.'
            )}
        </p>
      </FormField>
    </>
  )
}
