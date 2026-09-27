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
import { translate } from '@/i18n/i18n'

/** The statements a submit will run, written out with literals for review. */
export function DatabaseChangesPreviewDialog({
  sql,
  submitting,
  onSubmit,
  onClose
}: {
  sql: string
  submitting: boolean
  onSubmit: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{translate('database.preview.title', 'Pending Changes')}</DialogTitle>
          <DialogDescription>
            {translate(
              'database.preview.description',
              'Submitting runs these statements in one transaction, with the values sent as parameters.'
            )}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-96 overflow-auto scrollbar-editor whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
          {sql}
        </pre>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {translate('database.preview.close', 'Close')}
          </Button>
          <Button disabled={submitting} onClick={onSubmit}>
            {translate('database.edit.submit', 'Submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
