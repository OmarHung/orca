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
import { closeDatabaseTab, useDatabaseDialogsStore } from '../database-page-actions'
import { useDatabasePageStore } from '../database-page-store'
import { getConsoleRunState, useDatabaseConsoleRunStore } from './database-console-run-store'

const COMMIT = { start: 0, end: 6, terminatorEnd: 6, text: 'COMMIT' }

/** Asks before closing a console whose session holds an open transaction. */
export function DatabaseOpenTransactionDialog(): React.JSX.Element | null {
  const tabId = useDatabaseDialogsStore((state) => state.closingWithTransaction)
  const cancel = useDatabaseDialogsStore((state) => state.cancelEndTransaction)
  const tab = useDatabasePageStore((state) =>
    state.tabs.find((entry) => entry.id === tabId && entry.kind === 'console')
  )
  const failed = useDatabaseConsoleRunStore(
    (state) => tabId !== null && getConsoleRunState(state.consoles, tabId).transaction === 'failed'
  )
  const [committing, setCommitting] = useState(false)
  if (!tab || tab.kind !== 'console') {
    return null
  }
  // Closing ends the console's session, and the server rolls back what it left uncommitted.
  const rollBackAndClose = (): void => {
    cancel()
    closeDatabaseTab(tab.id, { discard: true })
  }
  const commitAndClose = async (): Promise<void> => {
    setCommitting(true)
    const runs = useDatabaseConsoleRunStore.getState()
    await runs.run(tab, [COMMIT], {
      transactionMode: tab.transactionMode,
      schema: tab.schema ?? undefined,
      database: tab.database ?? undefined
    })
    setCommitting(false)
    cancel()
    // A failed COMMIT leaves the console open with the error in its output.
    if (
      getConsoleRunState(useDatabaseConsoleRunStore.getState().consoles, tab.id).transaction ===
      'none'
    ) {
      closeDatabaseTab(tab.id, { discard: true })
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate('database.transactionDialog.title', 'Close with an open transaction?')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'database.transactionDialog.description',
              '{{value0}} has an open transaction. Closing it rolls back anything not committed.',
              { value0: tab.title }
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            {translate('database.transactionDialog.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={rollBackAndClose}>
            {translate('database.transactionDialog.rollBack', 'Roll Back and Close')}
          </Button>
          {failed ? null : (
            <Button disabled={committing} onClick={() => void commitAndClose()}>
              {translate('database.transactionDialog.commit', 'Commit and Close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
