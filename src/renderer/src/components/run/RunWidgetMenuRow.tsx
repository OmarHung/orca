import React from 'react'
import { Bot, Bug, Clock, EyeOff, Play, RotateCcw, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { isTerminalAgentQuickCommand } from '../../../../shared/terminal-quick-commands'
import { RUN_KIND_ICONS, runConfigurationIcon } from './run-configuration-icon'
import { debugStopAction } from './RunStopControl'
import type { RunStopStage } from './run-session-store'
import { runStopAction, stoppingLabel } from './run-stop-stage-presentation'
import { canDebugWidgetItem, canRunWidgetItem } from './run-widget-actions'
import type { RunWidgetItem } from './run-widget-items'

/** Whether an item's runs or debug session are live; a compound counts its members. */
export type RunWidgetRowState = {
  running: boolean
  debugging: boolean
  /** What Stop does next to the item's runs; null when it has none running. */
  stopStage: RunStopStage | null
}

export type RunWidgetRowActions = {
  run: (item: RunWidgetItem) => void
  debug: (item: RunWidgetItem) => void
  rerun: (item: RunWidgetItem) => void
  stop: (item: RunWidgetItem) => void
}

/** What every section of the Run widget menu needs to render and drive its rows. */
export type RunWidgetRowContext = {
  selectedKey: string | null
  onSelect: (item: RunWidgetItem) => void
  rowState: (item: RunWidgetItem) => RunWidgetRowState
  rowActions: RunWidgetRowActions
}

function itemIcon(item: RunWidgetItem): React.JSX.Element {
  switch (item.kind) {
    case 'recent':
      return <Clock />
    case 'configuration': {
      const Icon = runConfigurationIcon(item.configuration)
      return <Icon />
    }
    case 'quick-command':
      return isTerminalAgentQuickCommand(item.entry.command) ? <Bot /> : <Zap />
    case 'detected': {
      const Icon = RUN_KIND_ICONS[item.configuration.kind]
      return <Icon />
    }
  }
}

function RowButton({
  label,
  testId,
  onClick,
  children
}: {
  label: string
  testId: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          tabIndex={-1}
          aria-label={label}
          data-testid={testId}
          onClick={(event) => {
            // Why: the row itself selects the item and closes the menu.
            event.stopPropagation()
            onClick()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function LiveRowButtons({
  item,
  state,
  actions
}: {
  item: RunWidgetItem
  state: RunWidgetRowState
  actions: RunWidgetRowActions
}): React.JSX.Element {
  // Why: a debug-only row restarts its debugger; anything that runs reruns through the launcher.
  const restartsDebugger = state.debugging && !state.running
  const value0 = item.label
  const stop =
    restartsDebugger || !state.stopStage
      ? debugStopAction(value0)
      : runStopAction(state.stopStage, value0, {
          several: item.kind === 'configuration' && item.configuration.type === 'compound'
        })
  const StopIcon = stop.icon
  return (
    <>
      {state.stopStage && state.stopStage !== 'interrupt' ? (
        <span className="px-1 text-muted-foreground">{stoppingLabel()}</span>
      ) : null}
      <RowButton
        label={
          restartsDebugger
            ? translate('run.debug.restart', "Restart debugging '{{value0}}'", { value0 })
            : translate('run.action.rerun', "Rerun '{{value0}}'", { value0 })
        }
        testId="run-widget-item-rerun"
        onClick={() => (restartsDebugger ? actions.debug(item) : actions.rerun(item))}
      >
        <RotateCcw />
      </RowButton>
      <RowButton
        label={stop.label}
        testId="run-widget-item-stop"
        onClick={() => actions.stop(item)}
      >
        <StopIcon />
      </RowButton>
    </>
  )
}

function IdleRowButtons({
  item,
  actions,
  onHide
}: {
  item: RunWidgetItem
  actions: RunWidgetRowActions
  onHide?: (item: RunWidgetItem) => void
}): React.JSX.Element {
  const value0 = item.label
  return (
    <span className="flex items-center opacity-0 transition-opacity group-hover/run-row:opacity-100 group-focus-within/run-row:opacity-100">
      {onHide ? (
        <RowButton
          label={translate('run.widget.hideRun', "Hide '{{value0}}'", { value0 })}
          testId="run-widget-item-hide"
          onClick={() => onHide(item)}
        >
          <EyeOff />
        </RowButton>
      ) : null}
      {canRunWidgetItem(item) ? (
        <RowButton
          label={translate('run.action.runNamed', "Run '{{value0}}'", { value0 })}
          testId="run-widget-item-run"
          onClick={() => actions.run(item)}
        >
          <Play />
        </RowButton>
      ) : null}
      {canDebugWidgetItem(item) ? (
        <RowButton
          label={translate('run.configurations.debugNamed', "Debug '{{value0}}'", { value0 })}
          testId="run-widget-item-debug"
          onClick={() => actions.debug(item)}
        >
          <Bug />
        </RowButton>
      ) : null}
    </span>
  )
}

/**
 * A row of the Run widget menu, as in JetBrains: a live item shows a green dot with Rerun and
 * Stop; an idle one offers Run and Debug on hover. The row itself only selects.
 */
export function RunWidgetMenuRow({
  item,
  current,
  state,
  actions,
  onSelect,
  onHide
}: {
  item: RunWidgetItem
  current: boolean
  state: RunWidgetRowState
  actions: RunWidgetRowActions
  onSelect: (item: RunWidgetItem) => void
  /** Offered on idle rows that can be hidden from the menu. */
  onHide?: (item: RunWidgetItem) => void
}): React.JSX.Element {
  const live = state.running || state.debugging
  return (
    <DropdownMenuItem
      className="group/run-row"
      data-current={current}
      data-run-active={live}
      data-testid="run-widget-item"
      onSelect={() => onSelect(item)}
    >
      <span className="relative flex shrink-0">
        {itemIcon(item)}
        {live ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-status-success ring-1 ring-popover"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {item.kind === 'detected' ? item.configuration.name : item.label}
      </span>
      <span className="-my-1 flex shrink-0 items-center">
        {live ? (
          <LiveRowButtons item={item} state={state} actions={actions} />
        ) : (
          <IdleRowButtons item={item} actions={actions} onHide={onHide} />
        )}
      </span>
    </DropdownMenuItem>
  )
}
