import React, { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { DebugBreakpointsList } from './DebugBreakpointsList'
import { DebugConsole } from './DebugConsole'

type SideTab = 'console' | 'breakpoints'

function TabButton({
  active,
  label,
  onClick
}: {
  active: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        'rounded px-1.5 py-0.5 text-xs font-semibold transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

/** Console and Breakpoints share the Debug window's right column, as tabs. */
export function DebugSidePane(): React.JSX.Element {
  const [tab, setTab] = useState<SideTab>('console')
  return (
    <div className="flex min-h-0 flex-col">
      <div role="tablist" className="flex shrink-0 items-center gap-1 px-1 py-0.5">
        <TabButton
          active={tab === 'console'}
          label={translate('debug.console', 'Console')}
          onClick={() => setTab('console')}
        />
        <TabButton
          active={tab === 'breakpoints'}
          label={translate('debug.breakpoints.title', 'Breakpoints')}
          onClick={() => setTab('breakpoints')}
        />
      </div>
      {tab === 'console' ? <DebugConsole /> : <DebugBreakpointsList />}
    </div>
  )
}
