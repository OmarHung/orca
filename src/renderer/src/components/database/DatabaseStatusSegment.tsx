import React from 'react'
import { Database } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'
import { toggleDatabasePage } from './database-page-navigation'

/** Status-bar entry to the Database page, next to the Git Log and Debug toggles. */
export function DatabaseStatusSegment(): React.JSX.Element | null {
  const active = useAppStore((state) => state.activeView === 'database')
  const shortcut = useShortcutLabel('databasePage.toggle')
  if (isWebClientLocation()) {
    return null
  }
  const label = translate('database.statusBar.label', 'Database')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={active}
          aria-label={label}
          data-testid="database-status-toggle"
          className={cn(
            'inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            active && 'text-foreground'
          )}
          onClick={toggleDatabasePage}
        >
          <Database className="size-3.5" />
          <span>{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {shortcut ? `${label} (${shortcut})` : label}
      </TooltipContent>
    </Tooltip>
  )
}
