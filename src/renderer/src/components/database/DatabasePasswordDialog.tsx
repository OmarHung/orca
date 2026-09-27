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
import { isServerConnection } from '../../../../shared/database/database-connection-types'
import { useDatabaseConnectionsStore } from './database-connections-store'
import { connectDatabase } from './database-page-actions'

/** Shown when a connection has no usable password; follows the connection's save setting. */
export function DatabasePasswordDialog(): React.JSX.Element | null {
  const prompt = useDatabaseConnectionsStore((state) => state.passwordPrompt)
  const connection = useDatabaseConnectionsStore((state) =>
    state.connections.find((entry) => entry.id === prompt?.connectionId)
  )
  const dismiss = useDatabaseConnectionsStore((state) => state.dismissPasswordPrompt)
  const [password, setPassword] = useState('')
  const [connecting, setConnecting] = useState(false)

  // SQLite files have no password, so they never reach this prompt.
  if (!prompt || !connection || !isServerConnection(connection)) {
    return null
  }

  const submit = async (): Promise<void> => {
    setConnecting(true)
    await connectDatabase(connection.id, password)
    setConnecting(false)
    setPassword('')
  }

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {translate('database.passwordDialog.title', 'Password for {{value0}}', {
              value0: connection.name
            })}
          </DialogTitle>
          <DialogDescription>
            {connection.user}@{connection.host}:{connection.port}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="space-y-3"
        >
          <Input
            type="password"
            aria-label={translate('database.connectionForm.password', 'Password')}
            autoFocus
            autoComplete="off"
            value={password}
            aria-invalid={prompt.error !== null}
            onChange={(event) => setPassword(event.target.value)}
          />
          {prompt.error ? <p className="text-xs text-destructive">{prompt.error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={dismiss}>
              {translate('database.passwordDialog.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={connecting}>
              {translate('database.passwordDialog.connect', 'Connect')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
