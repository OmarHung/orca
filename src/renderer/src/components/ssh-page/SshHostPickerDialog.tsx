import type { SshTarget } from '../../../../shared/ssh-types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { translate } from '@/i18n/i18n'
import { SshHostList } from './SshHostList'

type SshHostPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  targets: readonly SshTarget[]
  onSelect: (target: SshTarget) => void
  title?: string
  description?: string
}

/** A tab strip's "+" on the SSH and SFTP pages: pick a host, then it opens in a new tab. */
export function SshHostPickerDialog({
  open,
  onOpenChange,
  targets,
  onSelect,
  title,
  description
}: SshHostPickerDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[28rem] flex-col"
        // Why: restoring focus to "+" would steal it from the terminal the pick just opened.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {title ?? translate('sshPage.picker.title', 'Open an SSH session')}
          </DialogTitle>
          <DialogDescription>
            {description ?? translate('sshPage.picker.description', 'Pick the host to connect to.')}
          </DialogDescription>
        </DialogHeader>
        <SshHostList
          targets={targets}
          onSelect={(target) => {
            onOpenChange(false)
            onSelect(target)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
