import React from 'react'
import { SquareTerminal, Table2, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { closeDatabaseTab } from './database-page-actions'
import { useDatabasePageStore } from './database-page-store'

export function DatabaseTabStrip(): React.JSX.Element {
  const tabs = useDatabasePageStore((state) => state.tabs)
  const activeTabId = useDatabasePageStore((state) => state.activeTabId)
  const activateTab = useDatabasePageStore((state) => state.activateTab)

  return (
    <div
      role="tablist"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto scrollbar-sleek border-b border-border"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => activateTab(tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                closeDatabaseTab(tab.id)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                activateTab(tab.id)
              }
            }}
            className={cn(
              'group flex max-w-56 shrink-0 cursor-default items-center gap-1.5 border-r border-border px-3 text-xs text-muted-foreground hover:bg-accent/50',
              active && 'bg-background text-foreground'
            )}
          >
            {tab.kind === 'table' ? (
              <Table2 className="size-3.5 shrink-0" />
            ) : (
              <SquareTerminal className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{tab.title}</span>
            <button
              type="button"
              aria-label={translate('database.tabs.close', 'Close tab')}
              onClick={(event) => {
                event.stopPropagation()
                closeDatabaseTab(tab.id)
              }}
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 hover:bg-accent group-hover:opacity-100',
                active && 'opacity-100'
              )}
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
