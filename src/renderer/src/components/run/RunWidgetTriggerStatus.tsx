import React from 'react'
import { translate } from '@/i18n/i18n'
import { RunStatusIcon } from './RunStatusIcon'
import { describeRunStatus } from './run-status-presentation'
import {
  runWidgetLiveStatus,
  type RunWidgetActivity,
  type RunWidgetFootprint
} from './run-widget-activity'
import type { RunWidgetItem } from './run-widget-items'

/**
 * The selected item's live run or debug session, beside its name: next to Rerun and Stop the
 * pulsing ▷ read as another Run button.
 */
export function RunWidgetTriggerStatus({
  item,
  footprint,
  activity
}: {
  item: RunWidgetItem
  footprint: RunWidgetFootprint
  activity: RunWidgetActivity
}): React.JSX.Element | null {
  const live = runWidgetLiveStatus(item, footprint, activity)
  if (!live) {
    return null
  }
  const status = live.run ? describeRunStatus(live.run) : translate('run.debug.status', 'Debugging')
  return (
    <span
      data-testid="run-configurations-trigger-status"
      className="flex shrink-0"
      title={`${item.label}: ${status}`}
    >
      <RunStatusIcon tone="running" mode={live.mode} />
    </span>
  )
}
