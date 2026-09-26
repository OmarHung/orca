import React from 'react'
import { ArrowUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import {
  findRunConfiguration,
  type CompoundMemberWait,
  type CompoundRunConfiguration,
  type RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import { CompoundMemberWaitField } from './CompoundMemberWaitField'
import { CompoundRunPicker } from './CompoundRunPicker'

function withWait(
  compound: CompoundRunConfiguration,
  reference: string,
  wait: CompoundMemberWait | undefined
): CompoundRunConfiguration {
  const { [reference]: _removed, ...rest } = compound.waitAfter ?? {}
  const waitAfter = wait ? { ...rest, [reference]: wait } : rest
  return {
    ...compound,
    waitAfter: Object.keys(waitAfter).length > 0 ? waitAfter : undefined
  }
}

/**
 * Members of a compound: saved configurations or runs detected in the workspace, started
 * together or in order with a wait after each.
 */
export function CompoundMembersEditor({
  compound,
  all,
  detected,
  worktreePath,
  readOnly,
  onChange,
  onPickDetected
}: {
  compound: CompoundRunConfiguration
  all: readonly RunConfigurationDefinition[]
  /** Null while the workspace is being scanned. */
  detected: readonly DetectedRunConfiguration[] | null
  worktreePath: string
  readOnly: boolean
  onChange: (compound: CompoundRunConfiguration) => void
  /** Returns the id of the configuration that now stands for the detected run. */
  onPickDetected: (detected: DetectedRunConfiguration) => string
}): React.JSX.Element {
  const references = compound.configurations
  const saved = all.filter(
    (candidate) => candidate.id !== compound.id && !references.includes(candidate.id)
  )
  const sequential = compound.sequential === true
  const move = (index: number): void => {
    const next = [...references]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    onChange({ ...compound, configurations: next })
  }
  const remove = (reference: string): void =>
    onChange(
      withWait(
        {
          ...compound,
          configurations: references.filter((entry) => entry !== reference)
        },
        reference,
        undefined
      )
    )
  const add = (reference: string): void => {
    if (!references.includes(reference)) {
      onChange({ ...compound, configurations: [...references, reference] })
    }
  }

  return (
    <div data-testid="compound-members-editor" className="space-y-2">
      <label className="flex cursor-pointer items-center gap-2">
        <Switch
          checked={sequential}
          disabled={readOnly}
          data-testid="compound-sequential"
          onCheckedChange={(checked) => onChange({ ...compound, sequential: checked || undefined })}
        />
        <span className="text-xs">
          {sequential
            ? translate('run.compound.sequential', 'Start one by one, in this order')
            : translate('run.compound.together', 'Start all together')}
        </span>
      </label>
      {references.length > 0 ? (
        <ol className="divide-y divide-border rounded-md border border-border">
          {references.map((reference, index) => {
            const target = findRunConfiguration(all, reference)
            const isLast = index === references.length - 1
            return (
              <li key={reference} className="flex items-center gap-2 px-2 py-1 text-xs">
                <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {target?.name ??
                    translate('run.configurations.form.missingReference', '{{value0}} (missing)', {
                      value0: reference
                    })}
                </span>
                {sequential && !isLast ? (
                  <CompoundMemberWaitField
                    wait={compound.waitAfter?.[reference]}
                    disabled={readOnly}
                    onChange={(wait) => onChange(withWait(compound, reference, wait))}
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={readOnly || index === 0}
                  aria-label={translate('run.configurations.form.moveUp', 'Move up')}
                  onClick={() => move(index)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={readOnly}
                  aria-label={translate('run.configurations.form.remove', 'Remove')}
                  onClick={() => remove(reference)}
                >
                  <X />
                </Button>
              </li>
            )
          })}
        </ol>
      ) : null}
      <CompoundRunPicker
        detected={detected}
        saved={saved}
        worktreePath={worktreePath}
        disabled={readOnly}
        hasMembers={references.length > 0}
        onPickDetected={(run) => add(onPickDetected(run))}
        onPickSaved={add}
      />
      {sequential ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'run.compound.sequentialHint',
            'Each run gets its own terminal. "Wait until it exits 0" suits build or migrate steps; if one fails, the rest do not start. Use a delay for servers that keep running.'
          )}
        </p>
      ) : null}
    </div>
  )
}
