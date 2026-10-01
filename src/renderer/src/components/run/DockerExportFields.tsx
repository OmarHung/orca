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
  dockerExportCommand,
  type DockerExportRunConfiguration
} from '../../../../shared/run-configurations/docker-export-configuration'
import { FolderPathInput } from './FolderPathInput'
import { FormField } from './RunConfigurationFormField'

type Props = {
  configuration: DockerExportRunConfiguration
  disabled: boolean
  /** The workspace root when its folders are on this machine, so Browse can pick one. */
  browseRoot: string | null
  /** The Dockerfile's export stages; the stage is typed in when none are known. */
  stages: readonly string[]
  onChange: (configuration: DockerExportRunConfiguration) => void
}

function StageField({ configuration, disabled, stages, onChange }: Props): React.JSX.Element {
  const label = translate('run.configurations.dockerExport.stage', 'Stage')
  if (stages.length === 0) {
    return (
      <FormField label={label}>
        <Input
          value={configuration.target}
          disabled={disabled}
          placeholder="export"
          data-testid="docker-export-stage"
          onChange={(event) => onChange({ ...configuration, target: event.target.value })}
        />
      </FormField>
    )
  }
  // Why: keep a stage orca.yaml names selectable even when the Dockerfile no longer has it.
  const options =
    configuration.target && !stages.includes(configuration.target)
      ? [...stages, configuration.target]
      : stages
  return (
    <FormField label={label}>
      <Select
        value={configuration.target}
        disabled={disabled}
        onValueChange={(target) => onChange({ ...configuration, target })}
      >
        <SelectTrigger size="sm" className="w-full" data-testid="docker-export-stage">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((stage) => (
            <SelectItem key={stage} value={stage}>
              {stage}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

function CleanOutputCheckbox({ configuration, disabled, onChange }: Props): React.JSX.Element {
  const id = useId()
  return (
    <FormField
      label={translate('run.configurations.dockerExport.cleanSection', 'Before exporting')}
      description={translate(
        'run.configurations.dockerExport.cleanHint',
        'Docker only adds and overwrites files, so files from an earlier export stay. On this computer the folder goes to the Trash; on an SSH host it is deleted.'
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={configuration.cleanOutputDir === true}
          disabled={disabled}
          data-testid="docker-export-clean"
          onCheckedChange={(checked) =>
            onChange({ ...configuration, cleanOutputDir: checked === true })
          }
        />
        <Label htmlFor={id}>
          {translate('run.configurations.dockerExport.clean', 'Empty the output folder')}
        </Label>
      </div>
    </FormField>
  )
}

/** `docker build --target <stage> -o <folder>` settings, with the exact command they produce. */
export function DockerExportFields(props: Props): React.JSX.Element {
  const { configuration, disabled, onChange } = props
  const pathHint = translate(
    'run.configurations.publish.projectFileHint',
    'Relative to the workspace root, or absolute.'
  )
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label={translate('run.configurations.dockerExport.dockerfile', 'Dockerfile')}
          description={pathHint}
        >
          <Input
            value={configuration.dockerfile}
            disabled={disabled}
            placeholder="Dockerfile"
            data-testid="docker-export-dockerfile"
            onChange={(event) => onChange({ ...configuration, dockerfile: event.target.value })}
          />
        </FormField>
        <FormField
          label={translate('run.configurations.dockerExport.context', 'Build context')}
          description={translate(
            'run.configurations.dockerExport.contextHint',
            "Empty uses the Dockerfile's folder."
          )}
        >
          <Input
            value={configuration.context ?? ''}
            disabled={disabled}
            placeholder="."
            data-testid="docker-export-context"
            onChange={(event) => onChange({ ...configuration, context: event.target.value })}
          />
        </FormField>
      </div>
      <StageField {...props} />
      <FormField
        label={translate('run.configurations.dockerExport.outputDir', 'Output folder')}
        description={pathHint}
      >
        <FolderPathInput
          value={configuration.outputDir}
          disabled={disabled}
          browseRoot={props.browseRoot}
          placeholder="publish/web"
          testIdPrefix="docker-export"
          onChange={(outputDir) => onChange({ ...configuration, outputDir })}
        />
      </FormField>
      <CleanOutputCheckbox {...props} />
      <FormField
        label={translate('run.configurations.publish.extraArgs', 'Additional arguments')}
        description={translate(
          'run.configurations.dockerExport.extraArgsHint',
          'Appended to the command as written, e.g. --build-arg VERSION=1.2.3'
        )}
      >
        <Input
          value={configuration.extraArgs ?? ''}
          disabled={disabled}
          data-testid="docker-export-extra-args"
          onChange={(event) => onChange({ ...configuration, extraArgs: event.target.value })}
        />
      </FormField>
      <FormField
        label={translate('run.configurations.publish.command', 'Runs from the workspace root')}
      >
        <p
          data-testid="docker-export-command"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs leading-5 break-all select-text"
        >
          {dockerExportCommand(configuration) ??
            translate(
              'run.configurations.dockerExport.unsafe',
              'Choose a stage, and use paths without " $ ` % ! or commas.'
            )}
        </p>
      </FormField>
    </>
  )
}
