import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/class-names'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { useRemoteHostsLayout } from './remote-hosts-layout-store'

/** The page's left column: hosts or saved commands. Both stay mounted to keep searches and scroll. */
export function RemoteSidePanel({
  hosts,
  commands
}: {
  hosts: React.ReactNode
  commands: React.ReactNode
}): React.JSX.Element {
  const tab = useRemoteHostsLayout((s) => s.sidePanelTab)
  const setTab = useRemoteHostsLayout((s) => s.setSidePanelTab)
  return (
    <div data-remote-side-panel className="flex w-72 shrink-0 flex-col border-r border-border">
      <div className="shrink-0 px-2 pt-1.5">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value === 'commands' ? 'commands' : 'hosts')}
        >
          <TabsList size="sm" className="w-full">
            <TabsTrigger value="hosts" data-remote-side-tab="hosts">
              {translate('sshPage.sidePanel.hosts', 'Hosts')}
            </TabsTrigger>
            <TabsTrigger value="commands" data-remote-side-tab="commands">
              {translate('sshPage.sidePanel.commands', 'Commands')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <SidePanelContent isShown={tab === 'hosts'}>{hosts}</SidePanelContent>
      <SidePanelContent isShown={tab === 'commands'}>{commands}</SidePanelContent>
    </div>
  )
}

function SidePanelContent({
  isShown,
  children
}: {
  isShown: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return <div className={cn('flex min-h-0 flex-1 flex-col', !isShown && 'hidden')}>{children}</div>
}
