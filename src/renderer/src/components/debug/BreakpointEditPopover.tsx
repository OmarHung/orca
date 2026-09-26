import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { useBreakpointStore, type BreakpointEdit, type BreakpointSpec } from './breakpoint-store'
import { removeDebugBreakpoint, updateDebugBreakpoint } from './breakpoint-sync'

function BreakpointForm({
  edit,
  spec,
  onDone
}: {
  edit: BreakpointEdit
  spec: BreakpointSpec
  onDone: () => void
}): React.JSX.Element {
  const [enabled, setEnabled] = useState(spec.enabled)
  const [condition, setCondition] = useState(spec.condition ?? '')
  const [hitCondition, setHitCondition] = useState(spec.hitCondition ?? '')
  const [logMessage, setLogMessage] = useState(spec.logMessage ?? '')

  const save = (): void => {
    updateDebugBreakpoint(edit.path, edit.line, { enabled, condition, hitCondition, logMessage })
    onDone()
  }

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="breakpoint-editor"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="text-sm font-medium">
        {translate('debug.breakpoint.title', '{{value0}}:{{value1}}', {
          value0: basename(edit.path),
          value1: String(edit.line)
        })}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="breakpoint-enabled"
          checked={enabled}
          onCheckedChange={(value) => setEnabled(value === true)}
        />
        <Label htmlFor="breakpoint-enabled">
          {translate('debug.breakpoint.enabled', 'Enabled')}
        </Label>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="breakpoint-condition">
          {translate('debug.breakpoint.condition', 'Condition')}
        </Label>
        <Input
          id="breakpoint-condition"
          autoFocus
          value={condition}
          placeholder={translate('debug.breakpoint.conditionHint', 'Pause when true, e.g. i > 10')}
          onChange={(event) => setCondition(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="breakpoint-hit">
          {translate('debug.breakpoint.hitCount', 'Hit count')}
        </Label>
        <Input
          id="breakpoint-hit"
          value={hitCondition}
          placeholder={translate('debug.breakpoint.hitCountHint', 'Pause on this hit, e.g. 3')}
          onChange={(event) => setHitCondition(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="breakpoint-log">
          {translate('debug.breakpoint.logMessage', 'Log message')}
        </Label>
        <Input
          id="breakpoint-log"
          value={logMessage}
          placeholder={translate(
            'debug.breakpoint.logMessageHint',
            'Log instead of pausing; {expression} is evaluated'
          )}
          onChange={(event) => setLogMessage(event.target.value)}
        />
      </div>
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            removeDebugBreakpoint(edit.path, edit.line)
            onDone()
          }}
        >
          {translate('debug.breakpoint.remove', 'Remove')}
        </Button>
        <Button type="submit" size="sm">
          {translate('debug.breakpoint.done', 'Done')}
        </Button>
      </div>
    </form>
  )
}

/** Edits the breakpoint the user right-clicked in the editor gutter. */
export function BreakpointEditPopover(): React.JSX.Element | null {
  const edit = useBreakpointStore((s) => s.editing)
  const spec = useBreakpointStore((s) =>
    s.editing
      ? s.breakpointsByFile[s.editing.path]?.find((candidate) => candidate.line === s.editing?.line)
      : undefined
  )
  const closeEditor = useBreakpointStore((s) => s.closeEditor)
  if (!edit || !spec) {
    return null
  }
  return (
    <Popover open onOpenChange={(open) => !open && closeEditor()}>
      <PopoverAnchor asChild>
        <span className="pointer-events-none fixed size-0" style={{ left: edit.x, top: edit.y }} />
      </PopoverAnchor>
      <PopoverContent side="right" align="start" className="w-80">
        <BreakpointForm
          key={`${edit.path}:${edit.line}`}
          edit={edit}
          spec={spec}
          onDone={closeEditor}
        />
      </PopoverContent>
    </Popover>
  )
}
