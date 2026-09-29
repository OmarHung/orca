import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useRemoteHostsLayout, type RemoteHostsPageId } from './remote-hosts-layout-store'

export function HostListToggleButton({ page }: { page: RemoteHostsPageId }): React.JSX.Element {
  const isCollapsed = useRemoteHostsLayout((s) => s.hostListCollapsed[page])
  const toggleHostList = useRemoteHostsLayout((s) => s.toggleHostList)
  const label = isCollapsed
    ? translate('sshPage.hostList.show', 'Show host list')
    : translate('sshPage.hostList.hide', 'Hide host list')
  const Icon = isCollapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={() => toggleHostList(page)}
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
