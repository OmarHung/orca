import { CalendarRange } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'
import { SidebarPageNavEntry } from '../sidebar/SidebarPageNavEntry'
import { openMondayPage } from './monday-page-navigation'

/** Left-sidebar entry to the monday schedule page, under Database. */
export function MondaySidebarNavEntry(): React.JSX.Element | null {
  const isActive = useAppStore((state) => state.activeView === 'monday')
  if (isWebClientLocation()) {
    return null
  }
  return (
    <SidebarPageNavEntry
      icon={CalendarRange}
      label={translate('monday.nav.label', 'monday')}
      isActive={isActive}
      onClick={openMondayPage}
      testId="monday-sidebar-nav"
    />
  )
}
