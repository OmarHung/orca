import React, { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { DATABASE_CONNECTION_GROUP_MAX_LENGTH } from '../../../../../shared/database/database-connection-types'
import { FormField } from '../../run/RunConfigurationFormField'
import { databaseConnectionGroupNames } from '../database-connection-groups'
import { useDatabaseConnectionsStore } from '../database-connections-store'

/** Typing a name files the connection under a new group; the menu picks an existing one. */
export function DatabaseConnectionGroupField({
  value,
  onChange
}: {
  value: string
  onChange: (group: string) => void
}): React.JSX.Element {
  const connections = useDatabaseConnectionsStore((state) => state.connections)
  const groups = useMemo(() => databaseConnectionGroupNames(connections), [connections])
  const label = translate('database.connectionForm.group', 'Group')
  return (
    <FormField
      label={label}
      description={translate(
        'database.connectionForm.groupHint',
        'Files the connection under this group in the connection list.'
      )}
    >
      <div className="flex gap-1.5">
        <Input
          aria-label={label}
          placeholder={translate('database.connectionForm.noGroup', 'None')}
          maxLength={DATABASE_CONNECTION_GROUP_MAX_LENGTH}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {groups.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={translate('database.connectionForm.pickGroup', 'Existing groups')}
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={value.trim()} onValueChange={onChange}>
                {groups.map((group) => (
                  <DropdownMenuRadioItem key={group} value={group}>
                    {group}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </FormField>
  )
}
