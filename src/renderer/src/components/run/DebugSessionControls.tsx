import React from 'react'
import { RotateCcw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { RunStatusIcon } from './RunStatusIcon'
import { ControlButton } from './RunSessionControls'

/** Status and Restart for the item's debug session; the widget's Stop control stops it. */
export function DebugSessionControls({
  label,
  onRestart
}: {
  label: string
  onRestart: () => void
}): React.JSX.Element {
  const status = translate('run.debug.status', 'Debugging')
  return (
    <div data-testid="run-debug-session" className="my-auto flex shrink-0 items-center gap-0.5">
      <span className="flex size-4 items-center justify-center" title={`${label}: ${status}`}>
        <RunStatusIcon tone="running" mode="debug" />
      </span>
      <ControlButton
        action={{
          icon: RotateCcw,
          label: translate('run.debug.restart', "Restart debugging '{{value0}}'", {
            value0: label
          }),
          testId: 'run-debug-restart',
          onClick: onRestart
        }}
      />
    </div>
  )
}
