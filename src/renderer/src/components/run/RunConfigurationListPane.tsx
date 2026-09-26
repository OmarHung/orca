import React from 'react'
import { Bug, Copy, Layers, Plus, SquareTerminal, Trash2, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type {
  RunConfigurationDefinition,
  RunConfigurationProblem
} from '../../../../shared/run-configurations/run-configuration-definition'
import { runConfigurationIcon } from './run-configuration-icon'
import type { RunConfigurationType } from './run-configuration-drafts'

const TYPE_ICONS: Record<RunConfigurationType, LucideIcon> = {
  command: SquareTerminal,
  debug: Bug,
  compound: Layers
}

function addLabel(type: RunConfigurationType): string {
  switch (type) {
    case 'command':
      return translate('run.configurations.add.command', 'Add command configuration')
    case 'debug':
      return translate('run.configurations.add.debug', 'Add debug configuration')
    case 'compound':
      return translate('run.configurations.add.compound', 'Add compound (start several together)')
  }
}

function Section({
  heading,
  entries,
  selectedId,
  onSelect
}: {
  heading: string
  entries: readonly RunConfigurationDefinition[]
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element | null {
  if (entries.length === 0) {
    return null
  }
  return (
    <div className="space-y-0.5">
      <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {heading}
      </div>
      {entries.map((entry) => {
        const Icon = runConfigurationIcon(entry)
        const current = entry.id === selectedId
        return (
          <button
            key={entry.id}
            type="button"
            data-current={current}
            data-testid="run-configuration-list-item"
            onClick={() => onSelect(entry.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent',
              current && 'bg-accent'
            )}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{entry.name || '—'}</span>
          </button>
        )
      })}
    </div>
  )
}

export function RunConfigurationListPane({
  local,
  shared,
  sharedProblems,
  selectedId,
  selectedIsLocal,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete
}: {
  local: readonly RunConfigurationDefinition[]
  shared: readonly RunConfigurationDefinition[]
  sharedProblems: readonly RunConfigurationProblem[]
  selectedId: string | null
  selectedIsLocal: boolean
  onSelect: (id: string) => void
  onAdd: (type: RunConfigurationType) => void
  onDuplicate: () => void
  onDelete: () => void
}): React.JSX.Element {
  const types: RunConfigurationType[] = ['command', 'debug', 'compound']
  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-border">
      <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
        {types.map((type) => {
          const Icon = TYPE_ICONS[type]
          const label = addLabel(type)
          return (
            <Tooltip key={type}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  data-testid={`run-configuration-add-${type}`}
                  aria-label={label}
                  onClick={() => onAdd(type)}
                >
                  <span className="relative">
                    <Icon />
                    <Plus className="absolute -right-1.5 -bottom-1 size-2.5" strokeWidth={3} />
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {label}
              </TooltipContent>
            </Tooltip>
          )
        })}
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!selectedId}
          aria-label={translate('run.configurations.duplicate', 'Duplicate')}
          onClick={onDuplicate}
        >
          <Copy />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!selectedIsLocal}
          data-testid="run-configuration-delete"
          aria-label={translate('run.configurations.delete', 'Delete')}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <Section
          heading={translate('run.configurations.localHeading', 'This machine')}
          entries={local}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <Section
          heading={translate('run.configurations.sharedHeading', 'Shared (orca.yaml)')}
          entries={shared}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        {local.length === 0 && shared.length === 0 ? (
          <p className="px-2 pt-3 text-xs text-muted-foreground">
            {translate('run.configurations.empty', 'No configurations yet. Add one with +.')}
          </p>
        ) : null}
        {sharedProblems.map((problem) => (
          <p key={problem.index} className="px-2 pt-2 text-[11px] text-destructive">
            {translate(
              'run.configurations.sharedProblem',
              'orca.yaml entry {{value0}}: {{value1}}',
              {
                value0: problem.index + 1,
                value1: problem.message
              }
            )}
          </p>
        ))}
      </div>
    </div>
  )
}
