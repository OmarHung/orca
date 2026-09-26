import React from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { DebugLaunchTarget } from '../../../../shared/debug/debug-session-types'
import {
  DEBUG_TARGET_KINDS,
  emptyDebugTarget,
  type DebugTargetKind
} from './run-configuration-drafts'
import { FormField } from './RunConfigurationFormField'

const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const

export function debugTargetKindLabel(kind: DebugTargetKind): string {
  switch (kind) {
    case 'python-file':
      return translate('run.configurations.target.pythonFile', 'Python file')
    case 'python-module':
      return translate('run.configurations.target.pythonModule', 'Python module')
    case 'node-file':
      return translate('run.configurations.target.nodeFile', 'Node.js file')
    case 'node-script':
      return translate('run.configurations.target.nodeScript', 'package.json script')
    case 'dotnet-project':
      return translate('run.configurations.target.dotnetProject', '.NET project (builds first)')
    case 'dotnet-program':
      return translate('run.configurations.target.dotnetProgram', '.NET assembly (prebuilt .dll)')
  }
}

const PATH_HINT = (): string =>
  translate(
    'run.configurations.form.pathHint',
    'Relative to the workspace root; ${workspaceFolder} and ${file} work too.'
  )

function TextField({
  label,
  value,
  placeholder,
  description,
  disabled,
  onChange,
  testId
}: {
  label: string
  value: string
  placeholder?: string
  description?: string
  disabled: boolean
  onChange: (value: string) => void
  testId: string
}): React.JSX.Element {
  return (
    <FormField label={label} description={description}>
      <Input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  )
}

function PythonPathField({
  target,
  disabled,
  onChange
}: {
  target: Extract<DebugLaunchTarget, { kind: 'python-file' | 'python-module' }>
  disabled: boolean
  onChange: (target: DebugLaunchTarget) => void
}): React.JSX.Element {
  return (
    <TextField
      label={translate('run.configurations.form.pythonPath', 'Interpreter')}
      value={target.pythonPath ?? ''}
      placeholder={translate('run.configurations.form.pythonPathAuto', 'Auto-detect (.venv first)')}
      disabled={disabled}
      testId="run-configuration-python-path"
      onChange={(pythonPath) => onChange({ ...target, pythonPath })}
    />
  )
}

function KindSpecificFields({
  target,
  disabled,
  onChange
}: {
  target: DebugLaunchTarget
  disabled: boolean
  onChange: (target: DebugLaunchTarget) => void
}): React.JSX.Element {
  switch (target.kind) {
    case 'python-file':
    case 'node-file':
      return (
        <>
          <TextField
            label={translate('run.configurations.form.file', 'File')}
            value={target.filePath}
            placeholder={target.kind === 'python-file' ? 'src/main.py' : 'src/index.js'}
            description={PATH_HINT()}
            disabled={disabled}
            testId="run-configuration-file"
            onChange={(filePath) => onChange({ ...target, filePath })}
          />
          {target.kind === 'python-file' ? (
            <PythonPathField target={target} disabled={disabled} onChange={onChange} />
          ) : null}
        </>
      )
    case 'python-module':
      return (
        <>
          <TextField
            label={translate('run.configurations.form.module', 'Module')}
            value={target.module}
            placeholder="app.main"
            disabled={disabled}
            testId="run-configuration-module"
            onChange={(module) => onChange({ ...target, module })}
          />
          <PythonPathField target={target} disabled={disabled} onChange={onChange} />
        </>
      )
    case 'node-script':
      return (
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
          <FormField label={translate('run.configurations.form.packageManager', 'Package manager')}>
            <Select
              value={target.packageManager}
              disabled={disabled}
              onValueChange={(value) => {
                const packageManager = PACKAGE_MANAGERS.find((name) => name === value)
                if (packageManager) {
                  onChange({ ...target, packageManager })
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PACKAGE_MANAGERS.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <TextField
            label={translate('run.configurations.form.script', 'Script')}
            value={target.script}
            placeholder="dev"
            disabled={disabled}
            testId="run-configuration-script"
            onChange={(script) => onChange({ ...target, script })}
          />
        </div>
      )
    case 'dotnet-project':
      return (
        <>
          <TextField
            label={translate('run.configurations.form.projectFile', 'Project file')}
            value={target.projectFile}
            placeholder="src/Api/Api.csproj"
            description={PATH_HINT()}
            disabled={disabled}
            testId="run-configuration-project-file"
            onChange={(projectFile) => onChange({ ...target, projectFile })}
          />
          <TextField
            label={translate('run.configurations.form.launchProfile', 'Launch profile')}
            value={target.launchProfile ?? ''}
            placeholder="http"
            disabled={disabled}
            testId="run-configuration-launch-profile"
            onChange={(launchProfile) => onChange({ ...target, launchProfile })}
          />
        </>
      )
    case 'dotnet-program':
      return (
        <TextField
          label={translate('run.configurations.form.program', 'Assembly')}
          value={target.program}
          placeholder="bin/Debug/net8.0/Api.dll"
          description={PATH_HINT()}
          disabled={disabled}
          testId="run-configuration-program"
          onChange={(program) => onChange({ ...target, program })}
        />
      )
  }
}

export function DebugTargetFields({
  target,
  disabled,
  onChange
}: {
  target: DebugLaunchTarget
  disabled: boolean
  onChange: (target: DebugLaunchTarget) => void
}): React.JSX.Element {
  return (
    <>
      <FormField label={translate('run.configurations.form.debugTarget', 'What to debug')}>
        <Select
          value={target.kind}
          disabled={disabled}
          onValueChange={(value) => {
            const kind = DEBUG_TARGET_KINDS.find((candidate) => candidate === value)
            if (kind && kind !== target.kind) {
              onChange(emptyDebugTarget(kind))
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full" data-testid="run-configuration-target-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEBUG_TARGET_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {debugTargetKindLabel(kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <KindSpecificFields target={target} disabled={disabled} onChange={onChange} />
    </>
  )
}
