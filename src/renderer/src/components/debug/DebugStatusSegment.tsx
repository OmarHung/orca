import React from 'react'
import { Bug } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { BottomPanelTabStatusSegment } from '../bottom-panel/BottomPanelTabStatusSegment'

export function DebugStatusSegment(): React.JSX.Element {
  return (
    <BottomPanelTabStatusSegment
      tab="debug"
      icon={Bug}
      label={translate('debug.toolWindow', 'Debug')}
      testId="debug-status-toggle"
    />
  )
}
