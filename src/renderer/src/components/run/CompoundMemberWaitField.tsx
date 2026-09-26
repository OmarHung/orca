import React from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  MAX_COMPOUND_DELAY_SECONDS,
  type CompoundMemberWait
} from '../../../../shared/run-configurations/run-configuration-definition'

const DEFAULT_DELAY_SECONDS = 3

type WaitChoice = 'none' | 'delay' | 'exit'

function clampSeconds(value: number): number {
  return Math.min(MAX_COMPOUND_DELAY_SECONDS, Math.max(1, Math.round(value)))
}

/** What a sequential compound waits for after starting one member, before the next. */
export function CompoundMemberWaitField({
  wait,
  disabled,
  onChange
}: {
  wait: CompoundMemberWait | undefined
  disabled?: boolean
  onChange: (wait: CompoundMemberWait | undefined) => void
}): React.JSX.Element {
  const choice: WaitChoice = wait?.kind ?? 'none'
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Select
        value={choice}
        disabled={disabled}
        onValueChange={(value) => {
          if (value === 'exit') {
            onChange({ kind: 'exit' })
          } else if (value === 'delay') {
            onChange({ kind: 'delay', seconds: DEFAULT_DELAY_SECONDS })
          } else {
            onChange(undefined)
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-48"
          aria-label={translate('run.compound.wait.label', 'Then')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="none">
            {translate('run.compound.wait.none', 'Start next now')}
          </SelectItem>
          <SelectItem value="delay">
            {translate('run.compound.wait.delay', 'Wait seconds')}
          </SelectItem>
          <SelectItem value="exit">
            {translate('run.compound.wait.exit', 'Wait until it exits 0')}
          </SelectItem>
        </SelectContent>
      </Select>
      {wait?.kind === 'delay' ? (
        <Input
          type="number"
          min={1}
          max={MAX_COMPOUND_DELAY_SECONDS}
          value={wait.seconds}
          disabled={disabled}
          aria-label={translate('run.compound.wait.seconds', 'Seconds to wait')}
          className="w-20"
          onChange={(event) => {
            const seconds = Number(event.target.value)
            if (Number.isFinite(seconds) && seconds > 0) {
              onChange({ kind: 'delay', seconds: clampSeconds(seconds) })
            }
          }}
        />
      ) : null}
    </div>
  )
}
