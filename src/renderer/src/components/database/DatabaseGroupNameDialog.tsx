import React, { useState } from 'react'
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
import { translate } from '@/i18n/i18n'
import { DATABASE_CONNECTION_GROUP_MAX_LENGTH } from '../../../../shared/database/database-connection-types'
import {
  moveDatabaseConnectionsToGroup,
  renameDatabaseConnectionGroup
} from './database-connection-group-actions'
import { normalizeDatabaseConnectionGroup } from './database-connection-groups'
import { useDatabaseDialogsStore, type GroupNameRequest } from './database-page-actions'

function GroupNameForm({
  request,
  onClose
}: {
  request: GroupNameRequest
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState(request.mode === 'rename' ? request.group : '')
  const [saving, setSaving] = useState(false)
  const group = normalizeDatabaseConnectionGroup(name)
  const label = translate('database.groups.name', 'Group name')

  const submit = async (): Promise<void> => {
    if (group === null || saving) {
      return
    }
    setSaving(true)
    await (request.mode === 'new'
      ? moveDatabaseConnectionsToGroup(request.connectionIds, group)
      : renameDatabaseConnectionGroup(request.group, group))
    setSaving(false)
    onClose()
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="space-y-3"
    >
      <Input
        aria-label={label}
        placeholder={label}
        autoFocus
        autoComplete="off"
        maxLength={DATABASE_CONNECTION_GROUP_MAX_LENGTH}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {translate('database.groups.cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={group === null || saving}>
          {request.mode === 'new'
            ? translate('database.groups.create', 'Create')
            : translate('database.groups.rename', 'Rename')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Names a new explorer group, or renames one. */
export function DatabaseGroupNameDialog(): React.JSX.Element | null {
  const request = useDatabaseDialogsStore((state) => state.groupNameRequest)
  const close = useDatabaseDialogsStore((state) => state.closeGroupName)
  if (!request) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {request.mode === 'new'
              ? translate('database.groups.newTitle', 'New Group')
              : translate('database.groups.renameTitle', 'Rename Group')}
          </DialogTitle>
          <DialogDescription>
            {request.mode === 'new'
              ? translate(
                  'database.groups.newDescription',
                  'Groups organize the connection list. An empty group disappears.'
                )
              : translate(
                  'database.groups.renameDescription',
                  'Renaming to an existing group’s name merges the two.'
                )}
          </DialogDescription>
        </DialogHeader>
        <GroupNameForm
          key={request.mode === 'new' ? 'new' : request.group}
          request={request}
          onClose={close}
        />
      </DialogContent>
    </Dialog>
  )
}
