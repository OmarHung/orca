import React from 'react'
import { Bug, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { useDebugStore } from '../debug/debug-store'
import { DebugSessionControls } from './DebugSessionControls'
import { ControlButton, RunSessionControls } from './RunSessionControls'
import { RunStatusDot } from './RunStatusDot'
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
import {
  isCompoundItem,
  isFootprintActive,
  type RunWidgetActivity,
  type RunWidgetFootprint
} from './run-widget-activity'
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
 * One item never runs and debugs at once, as in JetBrains: the active mode's button gives way to
 * Rerun/Restart, and the other mode asks before stopping it.
 */
function SingleRunActions({
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
        showStop={false}
        // Why: configurations rerun through the launcher so trust and Before launch apply again.
        onRerun={
          item.kind === 'configuration' || (item.kind === 'recent' && item.savedTarget)
            ? () => void runWidgetItem(item, scope, confirm)
            : undefined
        }
      />
      {debugging ? <DebugSessionControls label={item.label} onRestart={debug} /> : null}
    </>
  )
}

/** A compound is live while any member runs or debugs; Rerun starts it all again. */
function CompoundRunActions({
  item,
  scope,
  live
}: {
  item: RunWidgetItem
  scope: RunWidgetScope
  live: boolean
}): React.JSX.Element {
  const confirm = useConfirmationDialog()
  const run = (): void => void runWidgetItem(item, scope, confirm)
  const status = translate('run.status.running', 'Running')
  return (
    <>
      {live ? null : (
        <ActionButton
          label={runLabel(item, false)}
          testId="run-configurations-launch"
          disabled={false}
          onClick={run}
        >
          <Play />
        </ActionButton>
      )}
      <ActionButton
        label={debugLabel(item, false)}
        testId="run-configurations-debug"
        disabled
        onClick={() => {}}
      >
        <Bug />
      </ActionButton>
      <div
        data-testid="run-configurations-session"
        data-run-status={live ? 'running' : 'idle'}
        className="my-auto flex shrink-0 items-center gap-0.5"
      >
        {live ? (
          <>
            <span
              className="flex size-4 items-center justify-center"
              title={`${item.label}: ${status}`}
            >
              <RunStatusDot tone="running" />
            </span>
            <ControlButton
              action={{
                icon: RotateCcw,
                label: translate('run.action.rerun', "Rerun '{{value0}}'", { value0: item.label }),
                testId: 'run-rerun',
                onClick: run
              }}
            />
          </>
        ) : null}
      </div>
    </>
  )
}

/**
 * Run, Debug and the live session's controls for the selected item. Stop lives in the widget's
 * shared Stop control, which covers every run in the worktree.
 */
export function RunWidgetActions({
  item,
  scope,
  footprint,
  activity
}: {
  item: RunWidgetItem
  scope: RunWidgetScope
  footprint: RunWidgetFootprint
  activity: RunWidgetActivity
}): React.JSX.Element {
  return isCompoundItem(item) ? (
    <CompoundRunActions item={item} scope={scope} live={isFootprintActive(footprint, activity)} />
  ) : (
    <SingleRunActions item={item} scope={scope} />
  )
}
