import React, { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type {
  CommandRunConfiguration,
  DebugRunConfiguration,
  RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { CompoundMembersEditor } from './CompoundMembersEditor'
import { ConfigurationReferenceList } from './ConfigurationReferenceList'
import { DebugTargetFields } from './DebugTargetFields'
import { FormField } from './RunConfigurationFormField'
import {
  formatArgs,
  formatEnv,
  parseArgs,
  parseEnv,
  referenceCandidates
} from './run-configuration-drafts'

type FormProps<T extends RunConfigurationDefinition> = {
  configuration: T
  all: readonly RunConfigurationDefinition[]
  readOnly: boolean
  onChange: (configuration: RunConfigurationDefinition) => void
}

function CwdField({
  configuration,
  readOnly,
  onChange
}: FormProps<CommandRunConfiguration | DebugRunConfiguration>): React.JSX.Element {
  return (
    <FormField
      label={translate('run.configurations.form.cwd', 'Working directory')}
      description={translate(
        'run.configurations.form.cwdHint',
        'Relative to the workspace root; empty means the root.'
      )}
    >
      <Input
        value={configuration.cwd ?? ''}
        disabled={readOnly}
        data-testid="run-configuration-cwd"
        onChange={(event) => onChange({ ...configuration, cwd: event.target.value })}
      />
    </FormField>
  )
}

function BeforeLaunchField({
  configuration,
  all,
  readOnly,
  onChange
}: FormProps<CommandRunConfiguration | DebugRunConfiguration>): React.JSX.Element {
  return (
    <FormField
      label={translate('run.configurations.form.beforeLaunch', 'Before launch')}
      description={translate(
        'run.configurations.form.beforeLaunchHint',
        'Run in order; each must exit with 0 before the next starts.'
      )}
    >
      <ConfigurationReferenceList
        testId="run-configuration-before-launch"
        references={configuration.beforeLaunch ?? []}
        candidates={referenceCandidates(all, configuration.id, ['command'])}
        all={all}
        disabled={readOnly}
        onChange={(beforeLaunch) => onChange({ ...configuration, beforeLaunch })}
      />
    </FormField>
  )
}

function CommandFields(props: FormProps<CommandRunConfiguration>): React.JSX.Element {
  const { configuration, readOnly, onChange } = props
  return (
    <>
      <FormField
        label={translate('run.configurations.form.command', 'Command')}
        description={translate(
          'run.configurations.form.commandHint',
          'Runs in its own terminal tab. ${file} and ${workspaceFolder} are expanded.'
        )}
      >
        <Textarea
          value={configuration.command}
          disabled={readOnly}
          data-testid="run-configuration-command"
          className="min-h-20"
          onChange={(event) => onChange({ ...configuration, command: event.target.value })}
        />
      </FormField>
      <CwdField {...props} />
      <BeforeLaunchField {...props} />
    </>
  )
}

function DebugFields(props: FormProps<DebugRunConfiguration>): React.JSX.Element {
  const { configuration, readOnly, onChange } = props
  // Why local text: parsing on every keystroke would drop a half-typed line.
  const [argsText, setArgsText] = useState(() => formatArgs(configuration.args))
  const [envText, setEnvText] = useState(() => formatEnv(configuration.env))
  return (
    <>
      <DebugTargetFields
        target={configuration.target}
        disabled={readOnly}
        onChange={(target) => onChange({ ...configuration, target })}
      />
      <FormField
        label={translate('run.configurations.form.args', 'Program arguments')}
        description={translate('run.configurations.form.argsHint', 'One argument per line.')}
      >
        <Textarea
          value={argsText}
          disabled={readOnly}
          data-testid="run-configuration-args"
          className="min-h-16"
          onChange={(event) => {
            setArgsText(event.target.value)
            onChange({ ...configuration, args: parseArgs(event.target.value) })
          }}
        />
      </FormField>
      <FormField
        label={translate('run.configurations.form.env', 'Environment variables')}
        description={translate('run.configurations.form.envHint', 'One NAME=value per line.')}
      >
        <Textarea
          value={envText}
          disabled={readOnly}
          data-testid="run-configuration-env"
          className="min-h-16"
          onChange={(event) => {
            setEnvText(event.target.value)
            onChange({ ...configuration, env: parseEnv(event.target.value) })
          }}
        />
      </FormField>
      <CwdField {...props} />
      <BeforeLaunchField {...props} />
    </>
  )
}

/** The right-hand form of Edit Configurations; remount it per configuration (key by id). */
export function RunConfigurationForm(
  props: FormProps<RunConfigurationDefinition> & {
    detected: readonly DetectedRunConfiguration[] | null
    worktreePath: string
    onPickDetected: (detected: DetectedRunConfiguration) => string
  }
): React.JSX.Element {
  const { configuration, all, readOnly, onChange } = props
  return (
    <div className="space-y-4">
      <FormField label={translate('run.configurations.form.name', 'Name')}>
        <Input
          value={configuration.name}
          disabled={readOnly}
          data-testid="run-configuration-name"
          onChange={(event) => onChange({ ...configuration, name: event.target.value })}
        />
      </FormField>
      {configuration.type === 'command' ? (
        <CommandFields {...props} configuration={configuration} />
      ) : configuration.type === 'debug' ? (
        <DebugFields {...props} configuration={configuration} />
      ) : (
        <FormField
          label={translate('run.configurations.form.members', 'Configurations to start')}
          description={translate(
            'run.configurations.form.membersHint',
            'Before launch steps of all members run first. At most one may be a debug configuration.'
          )}
        >
          <CompoundMembersEditor
            compound={configuration}
            all={all}
            detected={props.detected}
            worktreePath={props.worktreePath}
            readOnly={readOnly}
            onChange={onChange}
            onPickDetected={props.onPickDetected}
          />
        </FormField>
      )}
    </div>
  )
}
