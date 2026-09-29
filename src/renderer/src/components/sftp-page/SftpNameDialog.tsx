import { useState } from 'react'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { translate } from '@/i18n/i18n'
import { isValidEntryName } from './sftp-paths'

export type SftpNameRequest = {
  title: string
  confirmLabel: string
  initialName: string
  onSubmit: (name: string) => void
}

/** Asks for one remote file or folder name (new folder, rename). */
export function SftpNameDialog({
  request,
  onClose
}: {
  request: SftpNameRequest | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm sm:max-w-sm">
        {request ? <SftpNameForm key={request.title} request={request} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function SftpNameForm({
  request,
  onClose
}: {
  request: SftpNameRequest
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState(request.initialName)
  const isValid = isValidEntryName(name)
  const submit = (): void => {
    if (isValid) {
      onClose()
      request.onSubmit(name.trim())
    }
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{request.title}</DialogTitle>
      </DialogHeader>
      <Input
        autoFocus
        value={name}
        aria-label={translate('sftpPage.nameDialog.label', 'Name')}
        aria-invalid={!isValid || undefined}
        onChange={(event) => setName(event.target.value)}
      />
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {translate('sftpPage.nameDialog.cancel', 'Cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!isValid}>
          {request.confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
