import { SquareTerminal } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { SidebarPageNavEntry } from '../sidebar/SidebarPageNavEntry'
import { openSshPage } from './ssh-page-navigation'

export function SshSidebarNavEntries(): React.JSX.Element {
  const activeView = useAppStore((s) => s.activeView)
  return (
    <SidebarPageNavEntry
      icon={SquareTerminal}
      label={translate('sshPage.nav.ssh', 'SSH')}
      isActive={activeView === 'ssh'}
      onClick={openSshPage}
    />
  )
}
