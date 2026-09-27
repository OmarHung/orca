import React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { useDatabaseDialogsStore } from '../database-page-actions'
import { useDatabasePageStore } from '../database-page-store'
import { getTableEditState, useDatabaseTableEditsStore } from './database-table-edits-store'
import { tableEditCount } from './table-edits'

/** Asks before closing or re-querying a table tab would throw away its pending edits. */
export function DatabaseDiscardEditsDialog(): React.JSX.Element | null {
  const pending = useDatabaseDialogsStore((state) => state.pendingDiscard)
  const cancel = useDatabaseDialogsStore((state) => state.cancelDiscard)
  const tab = useDatabasePageStore((state) =>
    state.tabs.find((entry) => entry.id === pending?.tabId)
  )
  const count = useDatabaseTableEditsStore((state) =>
    pending ? tableEditCount(getTableEditState(state.tabs, pending.tabId).edits) : 0
  )
  if (!pending || !tab) {
    return null
  }
  const discard = (): void => {
    useDatabaseTableEditsStore.getState().reset(pending.tabId)
    cancel()
    pending.proceed()
  }
  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {count === 1
              ? translate('database.discardDialog.titleOne', 'Discard 1 unsaved change?')
              : translate('database.discardDialog.title', 'Discard {{value0}} unsaved changes?', {
                  value0: count.toLocaleString(getIntlLocale())
                })}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'database.discardDialog.description',
              'Your edits to {{value0}} haven’t been submitted to the database.',
              { value0: tab.title }
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            {translate('database.discardDialog.keep', 'Keep Editing')}
          </Button>
          <Button onClick={discard}>
            {translate('database.discardDialog.discard', 'Discard')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
