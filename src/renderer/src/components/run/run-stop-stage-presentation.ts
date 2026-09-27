import { OctagonX, Square, X, type LucideIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { RunStopStage } from './run-session-store'

export type RunStopAction = { icon: LucideIcon; label: string }

/** Names what the next Stop press does, so a second press is never a surprise. */
export function runStopAction(
  stage: RunStopStage,
  name: string,
  options: { several?: boolean } = {}
): RunStopAction {
  const value0 = name
  switch (stage) {
    case 'interrupt':
      return { icon: Square, label: translate('run.action.stop', "Stop '{{value0}}'", { value0 }) }
    case 'force':
      return {
        icon: OctagonX,
        label: translate('run.action.forceStop', "Force stop '{{value0}}'", { value0 })
      }
    case 'close':
      return {
        icon: X,
        label: options.several
          ? translate('run.action.closeTerminals', "Close the terminals of '{{value0}}'", {
              value0
            })
          : translate('run.action.closeTerminal', "Close terminal '{{value0}}'", { value0 })
      }
  }
}

export function stopAllAction(stage: RunStopStage | null): RunStopAction {
  switch (stage) {
    case 'force':
      return { icon: OctagonX, label: translate('run.widget.forceStopAll', 'Force Stop All') }
    case 'close':
      return { icon: X, label: translate('run.widget.closeAllTerminals', 'Close All Terminals') }
    case 'interrupt':
    case null:
      return { icon: Square, label: translate('run.widget.stopAll', 'Stop All') }
  }
}

export function stoppingLabel(): string {
  return translate('run.status.stopping', 'Stopping…')
}
