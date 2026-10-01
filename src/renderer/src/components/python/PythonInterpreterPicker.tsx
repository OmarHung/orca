import React from 'react'
import { Check, ChevronDown, FolderOpen, RefreshCw } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
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

/**
 * The interpreter the active Python file runs and debugs with; running it is the Run widget's
 * "Current File" entry.
 */
export function PythonInterpreterPicker(): React.JSX.Element | null {
  const context = usePythonFileContext()
  if (!context) {
    return null
  }
  return (
    <div data-testid="python-file-controls" className="my-auto flex shrink-0 items-center">
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
    </div>
  )
}
