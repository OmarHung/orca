import React, { useEffect } from 'react'
import { Play } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { BottomPanelTabStatusSegment } from '../bottom-panel/BottomPanelTabStatusSegment'
import { ensureRunPanelTabGuard } from './run-panel-tab-guard'

export function RunStatusSegment(): React.JSX.Element {
  // Why here: the status bar is always mounted, and runs restored after a restart need the guard
  // before anything is launched.
  useEffect(() => {
    ensureRunPanelTabGuard()
  }, [])
  return (
    <BottomPanelTabStatusSegment
      tab="run"
      icon={Play}
      label={translate('run.toolWindow', 'Run')}
      testId="run-status-toggle"
    />
  )
}
