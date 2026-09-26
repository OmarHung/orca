import React from 'react'
import { Bug, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { useDebugStore } from '../debug/debug-store'
import { DebugSessionControls } from './DebugSessionControls'
import { RunSessionControls } from './RunSessionControls'
import { isDebuggingSource } from './run-debug-exclusivity'
import { isRunSessionActive } from './run-session-store'
import {
  canDebugWidgetItem,
  canRunWidgetItem,
  debugWidgetItem,
  runWidgetItem,
  runWidgetSessionTarget,
  type RunWidgetScope
} from './run-widget-actions'
import type { RunWidgetItem } from './run-widget-items'
import { useLiveRunSession } from './use-live-run-session'

function runLabel(item: RunWidgetItem, debugging: boolean): string {
  if (debugging) {
    return translate('run.action.stopDebugAndRun', "Stop debugging and run '{{value0}}'", {
      value0: item.label
    })
  }
  // Why the quick-command wording: it is the label upstream tests and users know that button by.
  return item.kind === 'quick-command'
    ? translate(
        'auto.components.tab.bar.TabBarQuickCommandsButton.b775303755',
        'Run quick command: {{value0}}',
        { value0: item.label }
      )
    : translate('run.action.runNamed', "Run '{{value0}}'", {
        value0: item.label
      })
}

function debugLabel(item: RunWidgetItem, running: boolean): string {
  return running
    ? translate('run.action.stopAndDebug', "Stop and debug '{{value0}}'", {
        value0: item.label
      })
    : translate('run.configurations.debugNamed', "Debug '{{value0}}'", {
        value0: item.label
      })
}

function ActionButton({
  label,
  testId,
  disabled,
  onClick,
  children
}: {
  label: string
  testId: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Why a span: a disabled button fires no pointer events, so its tooltip would never show. */}
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            data-testid={testId}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Run, Debug and the live session's controls for the selected item. One item never runs and
 * debugs at once, as in JetBrains: the active mode's button gives way to Rerun/Restart and Stop,
 * and the other mode asks before stopping it.
 */
export function RunWidgetActions({
  item,
  scope
}: {
  item: RunWidgetItem
  scope: RunWidgetScope
}): React.JSX.Element {
  const confirm = useConfirmationDialog()
  const target = runWidgetSessionTarget(item, scope)
  const runSession = useLiveRunSession(target)
  const running = runSession !== null && isRunSessionActive(runSession.status)
  const debugging = useDebugStore((s) => isDebuggingSource(s.session, scope.worktreeId, item.key))
  const debug = (): void => void debugWidgetItem(item, scope, confirm)

  return (
    <>
      {running ? null : (
        <ActionButton
          label={runLabel(item, debugging)}
          testId="run-configurations-launch"
          disabled={!canRunWidgetItem(item)}
          onClick={() => void runWidgetItem(item, scope, confirm)}
        >
          <Play />
        </ActionButton>
      )}
      {debugging ? null : (
        <ActionButton
          label={debugLabel(item, running)}
          testId="run-configurations-debug"
          disabled={!canDebugWidgetItem(item)}
          onClick={debug}
        >
          <Bug />
        </ActionButton>
      )}
      <RunSessionControls
        target={target}
        testId="run-configurations-session"
        // Why: configurations rerun through the launcher so trust and Before launch apply again.
        onRerun={
          item.kind === 'configuration' ? () => void runWidgetItem(item, scope, confirm) : undefined
        }
      />
      {debugging ? <DebugSessionControls label={item.label} onRestart={debug} /> : null}
    </>
  )
}
