import React from 'react'
import { ArrowUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  findRunConfiguration,
  type RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'

/** Ordered references to other configurations: Before launch steps or compound members. */
export function ConfigurationReferenceList({
  references,
  candidates,
  all,
  disabled,
  onChange,
  testId
}: {
  references: readonly string[]
  candidates: readonly RunConfigurationDefinition[]
  all: readonly RunConfigurationDefinition[]
  disabled: boolean
  onChange: (references: string[]) => void
  testId: string
}): React.JSX.Element {
  const available = candidates.filter((candidate) => !references.includes(candidate.id))
  const move = (index: number): void => {
    const next = [...references]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    onChange(next)
  }
  return (
    <div data-testid={testId} className="space-y-1.5">
      {references.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {references.map((reference, index) => {
            const target = findRunConfiguration(all, reference)
            return (
              <li key={reference} className="flex items-center gap-1 px-2 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {target?.name ??
                    translate('run.configurations.form.missingReference', '{{value0}} (missing)', {
                      value0: reference
                    })}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={disabled || index === 0}
                  aria-label={translate('run.configurations.form.moveUp', 'Move up')}
                  onClick={() => move(index)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={disabled}
                  aria-label={translate('run.configurations.form.remove', 'Remove')}
                  onClick={() => onChange(references.filter((entry) => entry !== reference))}
                >
                  <X />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
      <Select
        value=""
        disabled={disabled || available.length === 0}
        onValueChange={(id) => onChange([...references, id])}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue
            placeholder={
              available.length === 0
                ? translate(
                    'run.configurations.form.nothingToAdd',
                    'No other configurations to add'
                  )
                : translate('run.configurations.form.add', 'Add…')
            }
          />
        </SelectTrigger>
        <SelectContent position="popper">
          {available.map((candidate) => (
            <SelectItem key={candidate.id} value={candidate.id}>
              {candidate.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
