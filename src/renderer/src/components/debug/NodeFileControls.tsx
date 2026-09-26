import React from 'react'
import { Bug, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { basename, getRelativePathInsideRoot } from '@/lib/path'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { RunSessionControls } from '../run/RunSessionControls'
import { runConfiguration, type RunTarget } from '../run/run-configuration-control'
import { quoteShellArgument } from '../../../../shared/run-configurations/run-configuration-types'
import { debugFile, debugTargetForFile } from './debug-launch'
import { useDebugLaunchTarget } from './use-debug-launch-target'

function ControlButton({
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
          aria-label={label}
          data-testid={testId}
          onClick={onClick}
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

/** Run and Debug for the active JavaScript/TypeScript file (JetBrains "Current File"). */
export function NodeFileControls(): React.JSX.Element | null {
  const launch = useDebugLaunchTarget()
  const worktreePath = useAppStore((s) =>
    launch ? (findWorktreeById(s.worktreesByRepo, launch.worktreeId)?.path ?? null) : null
  )
  const groupId = useAppStore((s) =>
    launch ? (s.activeGroupIdByWorktree[launch.worktreeId] ?? null) : null
  )
  if (!launch || !worktreePath || debugTargetForFile(launch.filePath)?.kind !== 'node-file') {
    return null
  }
  const label = basename(launch.filePath)
  const relative = getRelativePathInsideRoot(launch.filePath, worktreePath) ?? launch.filePath
  const commandKey = `node-file:${launch.filePath}`
  const target: RunTarget = {
    worktreeId: launch.worktreeId,
    groupId,
    commandKey,
    command: {
      id: commandKey,
      label,
      command: `node ${quoteShellArgument(relative)}`,
      appendEnter: true
    }
  }
  return (
    <div data-testid="node-file-controls" className="my-auto flex shrink-0 items-center gap-0.5">
      <ControlButton
        label={translate('run.action.runNamed', "Run '{{value0}}'", { value0: label })}
        testId="node-run-file"
        onClick={() => void runConfiguration(target)}
      >
        <Play />
      </ControlButton>
      <ControlButton
        label={translate('debug.action.debugFile', "Debug '{{value0}}'", { value0: label })}
        testId="node-debug-file"
        onClick={() => void debugFile(launch.worktreeId, launch.filePath)}
      >
        <Bug />
      </ControlButton>
      <RunSessionControls target={target} testId="node-run-controls" />
    </div>
  )
}
