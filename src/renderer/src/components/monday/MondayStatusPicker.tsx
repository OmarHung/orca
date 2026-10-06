import React, { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { updateMondayPrefs } from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'
import { collectMondayStatusOptions, MONDAY_NO_STATUS } from './monday-status-filter'

const NO_STATUS_COLOR = 'var(--muted-foreground)'

function statusName(key: string): string {
  return key === MONDAY_NO_STATUS ? translate('monday.filter.statusNone', 'No status') : key
}

function triggerValue(selected: readonly string[]): string {
  if (selected.length === 0) {
    return translate('monday.filter.statusAll', 'All')
  }
  const rest = selected.length - 1
  const first = statusName(selected[0])
  return rest > 0 ? `${first} +${rest}` : first
}

/** Filters the loaded items in place, so changing it costs no monday API call. */
export function MondayStatusPicker(): React.JSX.Element {
  const schedule = useMondayPageStore((state) => state.schedule)
  const hideDone = useMondayPageStore((state) => state.prefs.hideDone)
  const selected = useMondayPageStore((state) => state.prefs.statusLabels)
  const [open, setOpen] = useState(false)
  const options = useMemo(
    () => (schedule ? collectMondayStatusOptions(schedule, hideDone, selected) : []),
    [schedule, hideDone, selected]
  )

  const toggle = (key: string): void => {
    updateMondayPrefs({
      statusLabels: selected.includes(key)
        ? selected.filter((label) => label !== key)
        : [...selected, key]
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          data-testid="monday-status-picker"
          className="max-w-56 justify-between"
        >
          <ListFilter className="size-3.5" />
          <span className="truncate">
            {translate('monday.filter.statusTrigger', 'Status: {{value0}}', {
              value0: triggerValue(selected)
            })}
          </span>
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              <CommandItem value="all" onSelect={() => updateMondayPrefs({ statusLabels: [] })}>
                <Check
                  className={cn('size-3.5', selected.length === 0 ? 'opacity-100' : 'opacity-0')}
                />
                {translate('monday.filter.statusShowAll', 'All statuses')}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            {options.length > 0 ? (
              <CommandGroup>
                {options.map((option, index) => (
                  // Why an index value: cmdk matches values case-insensitively, labels are not.
                  <CommandItem
                    key={option.key}
                    value={`status-${index}`}
                    onSelect={() => toggle(option.key)}
                  >
                    <Check
                      className={cn(
                        'size-3.5',
                        selected.includes(option.key) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: option.color ?? NO_STATUS_COLOR }}
                    />
                    <span className="min-w-0 flex-1 truncate">{statusName(option.key)}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {option.count}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                {translate('monday.filter.statusEmpty', 'No statuses on the shown boards.')}
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
