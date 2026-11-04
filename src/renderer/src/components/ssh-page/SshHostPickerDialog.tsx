import type { SshTarget } from '../../../../shared/ssh-types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { SshHostList } from './SshHostList'

const NO_OPEN_TABS: readonly { id: string; label: string }[] = []

type SshHostPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  targets: readonly SshTarget[]
  onSelect: (target: SshTarget) => void
  title?: string
  description?: string
  /** Tabs already open, listed above the hosts; choosing one needs no new connection. */
  openTabs?: readonly { id: string; label: string }[]
  onSelectTab?: (tabId: string) => void
}

/** Pick a host: the tab strip's "+", or what to add to the grid. */
export function SshHostPickerDialog({
  open,
  onOpenChange,
  targets,
  onSelect,
  title,
  description,
  openTabs = NO_OPEN_TABS,
  onSelectTab
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
        {openTabs.length > 0 ? (
          <div className="flex shrink-0 flex-col gap-0.5" data-ssh-picker-open-tabs>
            <p className="px-2 text-xs text-muted-foreground">
              {translate('sshPage.picker.openTabs', 'Open tabs')}
            </p>
            <div className="scrollbar-sleek flex max-h-28 flex-col gap-0.5 overflow-y-auto">
              {openTabs.map((tab) => (
                <Button
                  key={tab.id}
                  variant="ghost"
                  size="sm"
                  data-ssh-picker-tab={tab.id}
                  className="justify-start"
                  onClick={() => {
                    onOpenChange(false)
                    onSelectTab?.(tab.id)
                  }}
                >
                  <span className="truncate">{tab.label}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
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
