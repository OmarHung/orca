import React from 'react'
import { Bug } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { BottomPanelTabStatusSegment } from '../bottom-panel/BottomPanelTabStatusSegment'
import { BreakpointEditPopover } from './BreakpointEditPopover'

export function DebugStatusSegment(): React.JSX.Element {
  return (
    <>
      <BottomPanelTabStatusSegment
        tab="debug"
        icon={Bug}
        label={translate('debug.toolWindow', 'Debug')}
        testId="debug-status-toggle"
      />
      {/* Why here: the status bar is always mounted, unlike any one editor or the panel. */}
      <BreakpointEditPopover />
    </>
  )
}
