import React from 'react'
import { RotateCcw, Square } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { stopDebugSession } from '../debug/debug-session-controller'
import { RunStatusDot } from './RunStatusDot'
import { ControlButton } from './RunSessionControls'

/** Status, Restart and Stop for the item's debug session, mirroring the run controls. */
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
        <RunStatusDot tone="running" />
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
      <ControlButton
        action={{
          icon: Square,
          label: translate('run.debug.stop', "Stop debugging '{{value0}}'", {
            value0: label
          }),
          testId: 'run-debug-stop',
          onClick: () => void stopDebugSession()
        }}
      />
    </div>
  )
}
