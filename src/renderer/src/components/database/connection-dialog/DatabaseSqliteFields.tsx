import React from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { FormField } from '../../run/RunConfigurationFormField'
import type { DatabaseConnectionFormState } from './database-connection-form-state'
import { SwitchField } from './database-form-controls'

export function DatabaseSqliteFields({
  form,
  invalid,
  onChange
}: {
  form: DatabaseConnectionFormState
  invalid: ReadonlySet<keyof DatabaseConnectionFormState>
  onChange: (patch: Partial<DatabaseConnectionFormState>) => void
}): React.JSX.Element {
  const label = translate('database.connectionForm.file', 'Database file')
  const browse = async (): Promise<void> => {
    const picked = await window.api.database.pickSqliteFile()
    if (typeof picked === 'string') {
      onChange({ filePath: picked })
    }
  }
  return (
    <>
      <FormField
        label={label}
        description={translate(
          'database.connectionForm.fileHint',
          'An existing file on this computer. Orca does not create new database files.'
        )}
      >
        <div className="flex gap-2">
          <Input
            aria-label={label}
            value={form.filePath}
            placeholder={translate('database.connectionForm.filePlaceholder', '/path/to/app.db')}
            aria-invalid={invalid.has('filePath') && form.filePath.length > 0}
            onChange={(event) => onChange({ filePath: event.target.value })}
          />
          <Button type="button" variant="outline" onClick={() => void browse()}>
            <FolderOpen />
            {translate('database.connectionForm.browse', 'Browse…')}
          </Button>
        </div>
      </FormField>
      <SwitchField
        label={translate('database.connectionForm.readOnly', 'Read-only')}
        checked={form.readOnly}
        onChange={(readOnly) => onChange({ readOnly })}
      />
    </>
  )
}
