import React from 'react'
import { Bug, Check, ChevronDown, FolderOpen, Play, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { debugFile } from '../debug/debug-launch'
import { RunSessionControls } from '../run/RunSessionControls'
import { runConfiguration } from '../run/run-configuration-control'
import type { PythonInterpreter } from '../../../../shared/python-interpreter-types'
import { interpreterLabel, usePythonInterpreterStore } from './python-interpreter-store'
import { usePythonFileContext, type PythonFileContext } from './use-python-file-context'

function triggerLabel(context: PythonFileContext): string {
  if (!context.local) {
    return translate('python.interpreter.remote', 'python3 (host)')
  }
  if (context.interpreter) {
    return interpreterLabel(context.interpreter)
  }
  return context.detecting
    ? translate('python.interpreter.detecting', 'Detecting Python…')
    : translate('python.interpreter.none', 'No Python found')
}

function InterpreterMenu({ context }: { context: PythonFileContext }): React.JSX.Element {
  const setChoice = usePythonInterpreterStore((s) => s.setChoice)
  const detect = usePythonInterpreterStore((s) => s.detect)
  const { choice, interpreters, projectId, projectRoot } = context
  const autoTarget = interpreters[0]
  const isFixed = (interpreter: PythonInterpreter): boolean =>
    choice.mode === 'fixed' && choice.interpreter.path === interpreter.path
  const chooseFile = async (): Promise<void> => {
    const picked = await window.api.python.pickInterpreter(projectRoot)
    if (picked) {
      setChoice(projectId, { mode: 'fixed', interpreter: picked })
    }
  }
  const fixedOutsideDetection =
    choice.mode === 'fixed' &&
    !interpreters.some((interpreter) => interpreter.path === choice.interpreter.path)
      ? choice.interpreter
      : null

  return (
    <DropdownMenuContent align="end" className="w-80">
      <DropdownMenuLabel>
        {translate('python.interpreter.menuTitle', 'Python interpreter for this project')}
      </DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => setChoice(projectId, { mode: 'auto' })}>
        <span className="flex size-4 items-center justify-center">
          {choice.mode === 'auto' ? <Check /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {autoTarget
            ? translate('python.interpreter.autoWith', 'Auto: {{value0}}', {
                value0: interpreterLabel(autoTarget)
              })
            : translate('python.interpreter.auto', 'Auto')}
        </span>
      </DropdownMenuItem>
      {[...interpreters, ...(fixedOutsideDetection ? [fixedOutsideDetection] : [])].map(
        (interpreter) => (
          <DropdownMenuItem
            key={interpreter.path}
            onSelect={() => setChoice(projectId, { mode: 'fixed', interpreter })}
          >
            <span className="flex size-4 items-center justify-center">
              {isFixed(interpreter) ? <Check /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{interpreterLabel(interpreter)}</span>
              <span className="truncate text-xs text-muted-foreground">{interpreter.path}</span>
            </span>
          </DropdownMenuItem>
        )
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void chooseFile()}>
        <FolderOpen />
        {translate('python.interpreter.choose', 'Choose Interpreter…')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void detect(projectRoot, true)}>
        <RefreshCw />
        {translate('python.interpreter.refresh', 'Detect Again')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

function IconAction({
  label,
  testId,
  disabled = false,
  onClick,
  children
}: {
  label: string
  testId: string
  disabled?: boolean
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
          disabled={disabled}
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

/** Interpreter picker plus Run and Debug for the active Python file (JetBrains "Current File"). */
export function PythonFileControls(): React.JSX.Element | null {
  const context = usePythonFileContext()
  if (!context) {
    return null
  }
  const fileLabel = context.runTarget.command.label
  const debugLabel = context.local
    ? translate('debug.action.debugFile', "Debug '{{value0}}'", { value0: fileLabel })
    : translate('debug.localOnlyShort', 'Debugging needs a local workspace')

  return (
    <div data-testid="python-file-controls" className="my-auto flex shrink-0 items-center gap-0.5">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={!context.local}>
          <button
            type="button"
            data-testid="python-interpreter-trigger"
            className="flex h-6 max-w-48 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:hover:bg-transparent"
            title={context.interpreter?.path}
          >
            <span className="truncate">{triggerLabel(context)}</span>
            {context.local ? <ChevronDown className="size-3 shrink-0" /> : null}
          </button>
        </DropdownMenuTrigger>
        <InterpreterMenu context={context} />
      </DropdownMenu>
      <IconAction
        label={translate('python.action.runFile', "Run '{{value0}}'", { value0: fileLabel })}
        testId="python-run-file"
        onClick={() => void runConfiguration(context.runTarget)}
      >
        <Play />
      </IconAction>
      <IconAction
        label={debugLabel}
        testId="python-debug-file"
        disabled={!context.local}
        onClick={() =>
          void debugFile(context.worktreeId, context.filePath, context.interpreter?.path)
        }
      >
        <Bug />
      </IconAction>
      <RunSessionControls target={context.runTarget} testId="python-run-controls" />
    </div>
  )
}
