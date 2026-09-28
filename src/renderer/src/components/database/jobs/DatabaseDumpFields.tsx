import React from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { translate } from '@/i18n/i18n'
import type { DatabaseDumpOptions } from '../../../../../shared/database/database-dump-types'
import { SelectField } from '../connection-dialog/database-form-controls'
import type { DumpToolChoice } from './use-dump-dialog-data'

export function CheckboxField({
  label,
  description,
  checked,
  disabled,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-2.5">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
        className="mt-0.5"
      />
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  )
}

/** Orca's own dump or the server's native tool; hidden where no native tool applies. */
export function DumpToolField({
  choice,
  native,
  onChange
}: {
  choice: DumpToolChoice
  native: boolean
  onChange: (native: boolean) => void
}): React.JSX.Element | null {
  if (choice.kind === 'none') {
    return null
  }
  const found = choice.kind === 'found' ? choice.tool : null
  const description = found
    ? (found.problem ?? (native ? found.path : undefined))
    : translate(
        'database.dump.toolMissingHint',
        'Install {{value0}} to use it. Orca looks for it on PATH and in the usual install folders.',
        { value0: choice.kind === 'missing' ? choice.name : '' }
      )
  return (
    <SelectField<'builtin' | 'native'>
      label={translate('database.dump.tool', 'Tool')}
      description={description}
      value={native ? 'native' : 'builtin'}
      options={[
        { value: 'builtin', label: translate('database.dump.builtin', 'Orca (built-in)') },
        {
          value: 'native',
          label: found
            ? `${found.kind} ${found.version}`
            : translate('database.dump.toolMissing', '{{value0}} (not found)', {
                value0: choice.kind === 'missing' ? choice.name : ''
              }),
          disabled: !found || found.problem !== null
        }
      ]}
      onChange={(value) => onChange(value === 'native')}
    />
  )
}

/**
 * What the foreign key option means with the chosen tool: the native tools decide some of it
 * themselves, and then the option is shown checked but can't be changed.
 */
export function foreignKeyOption(
  native: DumpToolChoice | null,
  contents: DatabaseDumpOptions['contents']
): { locked: boolean; hint: string } {
  if (native?.kind !== 'found') {
    return {
      locked: false,
      hint: translate(
        'database.dump.disableForeignKeysHint',
        'Lets the file load in any table order without foreign key errors.'
      )
    }
  }
  if (native.tool.flavor !== 'postgres') {
    return {
      locked: true,
      hint: translate(
        'database.dump.mysqldumpForeignKeys',
        'mysqldump always switches foreign key checks off in its file.'
      )
    }
  }
  return contents === 'data'
    ? {
        locked: false,
        hint: translate(
          'database.dump.pgDumpDisableTriggers',
          'Adds pg_dump’s --disable-triggers; loading the file then takes a superuser.'
        )
      }
    : {
        locked: true,
        hint: translate(
          'database.dump.pgDumpForeignKeys',
          'pg_dump always adds foreign keys after the rows.'
        )
      }
}
