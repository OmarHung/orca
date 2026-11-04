import { Folder, SquareTerminal } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

function RowActionButton({
  label,
  action,
  onClick,
  children
}: {
  label: string
  action: 'terminal' | 'files'
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          data-ssh-host-open={action}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Clicking a host goes to its tab; these always open another one, in the layout they name. */
export function SshHostRowActions({
  onOpenTerminal,
  onOpenFiles
}: {
  onOpenTerminal: () => void
  onOpenFiles: () => void
}): React.JSX.Element {
  return (
    <>
      <RowActionButton
        label={translate('sshPage.hostRow.openTerminal', 'Open a terminal tab')}
        action="terminal"
        onClick={onOpenTerminal}
      >
        <SquareTerminal className="size-3.5" />
      </RowActionButton>
      <RowActionButton
        label={translate('sshPage.hostRow.openFiles', 'Open a files tab')}
        action="files"
        onClick={onOpenFiles}
      >
        <Folder className="size-3.5" />
      </RowActionButton>
    </>
  )
}
