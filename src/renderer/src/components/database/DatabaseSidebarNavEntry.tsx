import { Database } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'
import { SidebarPageNavEntry } from '../sidebar/SidebarPageNavEntry'
import { openDatabasePage } from './database-page-navigation'

/** Left-sidebar entry to the Database page, under SSH/SFTP. */
export function DatabaseSidebarNavEntry(): React.JSX.Element | null {
  const isActive = useAppStore((state) => state.activeView === 'database')
  if (isWebClientLocation()) {
    return null
  }
  return (
    <SidebarPageNavEntry
      icon={Database}
      label={translate('database.nav.label', 'Database')}
      isActive={isActive}
      onClick={openDatabasePage}
      testId="database-sidebar-nav"
    />
  )
}
