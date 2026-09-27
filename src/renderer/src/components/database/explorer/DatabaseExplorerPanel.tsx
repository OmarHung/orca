import React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useDatabaseDialogsStore } from '../database-page-actions'
import { DatabaseExplorer } from './DatabaseExplorer'

function newConnection(): void {
  useDatabaseDialogsStore.getState().openConnectionEditor({ mode: 'new' })
}

/**
 * The connection list with ways to add to it where it lives: a + button in its header and
 * New Connection on right-click. Rows keep their own menu (their handler claims the event).
 */
export function DatabaseExplorerPanel(): React.JSX.Element {
  const label = translate('database.page.newConnection', 'New Connection')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between pl-3 pr-1 text-xs text-muted-foreground">
        {translate('database.explorer.connections', 'Connections')}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={label} onClick={newConnection}>
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {label}
          </TooltipContent>
        </Tooltip>
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-h-0 flex-1">
            <DatabaseExplorer />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={newConnection}>
            <Plus />
            {translate('database.explorer.newConnection', 'New Connection…')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
