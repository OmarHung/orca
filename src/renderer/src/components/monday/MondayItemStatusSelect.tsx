import React, { useState } from 'react'
import { Check, ChevronDown, Loader2, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/class-names'
import type { MondayLabel, MondayStatusOption } from '../../../../shared/monday/monday-types'
import { mondayErrorMessage } from './monday-error-message'
import {
  loadMondayStatusOptions,
  mondayStatusColumnKey,
  setMondayItemStatus
} from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'
import { MondayLabelBadge } from './MondayScheduleVisuals'

function noStatusName(): string {
  return translate('monday.filter.statusNone', 'No status')
}

function StatusOptions(props: {
  boardId: string
  columnId: string
  current: string
  onPick: (option: MondayStatusOption) => void
}): React.JSX.Element {
  const { boardId, columnId, current, onPick } = props
  const state = useMondayPageStore(
    (store) => store.statusOptions[mondayStatusColumnKey(boardId, columnId)]
  )
  if (!state || state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {translate('monday.status.loading', 'Loading statuses…')}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-2 px-3 py-3">
        <p className="text-xs text-destructive">{mondayErrorMessage(state.error)}</p>
        <Button
          variant="outline"
          size="xs"
          onClick={() => void loadMondayStatusOptions(boardId, columnId)}
        >
          <RotateCw className="size-3" />
          {translate('monday.action.retry', 'Retry')}
        </Button>
      </div>
    )
  }
  return (
    <Command shouldFilter={false}>
      <CommandList>
        <CommandGroup>
          {state.options.map((option) => (
            // Why an id value: cmdk matches values case-insensitively, labels are not.
            <CommandItem
              key={option.id}
              value={`status-${option.id}`}
              onSelect={() => onPick(option)}
            >
              <Check
                className={cn('size-3.5', option.label === current ? 'opacity-100' : 'opacity-0')}
              />
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: option.color }}
              />
              <span
                className={cn('min-w-0 flex-1 truncate', !option.label && 'text-muted-foreground')}
              >
                {option.label || noStatusName()}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** The item's status as a dropdown that writes the choice back to monday. */
export function MondayItemStatusSelect(props: {
  boardId: string
  itemId: string
  columnId: string
  status: MondayLabel | null
}): React.JSX.Element {
  const { boardId, itemId, columnId, status } = props
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const loaded = useMondayPageStore(
    (store) => store.statusOptions[mondayStatusColumnKey(boardId, columnId)]?.status === 'ready'
  )

  const onOpenChange = (next: boolean): void => {
    setOpen(next)
    // Labels rarely change; one read per session keeps the dropdown off the shared daily limit.
    if (next && !loaded) {
      void loadMondayStatusOptions(boardId, columnId)
    }
  }

  const pick = async (option: MondayStatusOption): Promise<void> => {
    setOpen(false)
    if (option.label === (status?.label ?? '')) {
      return
    }
    setSaving(true)
    const error = await setMondayItemStatus({ boardId, itemId, columnId }, option)
    setSaving(false)
    if (error) {
      toast.error(translate('monday.status.saveFailed', 'Could not change the status'), {
        description: mondayErrorMessage(error)
      })
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={translate('monday.status.change', 'Change status')}
          disabled={saving}
          data-testid="monday-item-status-select"
          className="inline-flex max-w-full items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <MondayLabelBadge
            label={status ?? { label: noStatusName(), color: 'var(--muted-foreground)' }}
            className="hover:bg-accent"
          />
          {saving ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <StatusOptions
          boardId={boardId}
          columnId={columnId}
          current={status?.label ?? ''}
          onPick={(option) => void pick(option)}
        />
      </PopoverContent>
    </Popover>
  )
}
