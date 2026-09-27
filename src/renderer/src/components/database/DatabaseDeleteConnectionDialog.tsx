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
import { translate } from '@/i18n/i18n'
import { useDatabaseConnectionsStore } from './database-connections-store'
import { deleteDatabaseConnection, useDatabaseDialogsStore } from './database-page-actions'

export function DatabaseDeleteConnectionDialog(): React.JSX.Element | null {
  const connectionId = useDatabaseDialogsStore((state) => state.deletingConnectionId)
  const cancel = useDatabaseDialogsStore((state) => state.cancelDeleteConnection)
  const connection = useDatabaseConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === connectionId)
  )
  const [deleting, setDeleting] = useState(false)

  if (!connection) {
    return null
  }

  const confirm = async (): Promise<void> => {
    setDeleting(true)
    await deleteDatabaseConnection(connection.id)
    setDeleting(false)
    cancel()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {translate('database.deleteDialog.title', 'Delete {{value0}}?', {
              value0: connection.name
            })}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'database.deleteDialog.description',
              'This removes the connection, its saved password and its consoles from Orca. The database itself is not touched.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            {translate('database.deleteDialog.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={() => void confirm()}>
            {translate('database.deleteDialog.confirm', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
