import React, { useMemo } from 'react'
import { CalendarOff, PanelLeftClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { groupMondayUndatedEntries, type MondayCalendarEntry } from './monday-calendar-model'
import { selectMondayItem, updateMondayPrefs } from './monday-page-actions'

function UndatedRow({
  entry,
  selected
}: {
  entry: MondayCalendarEntry
  selected: boolean
}): React.JSX.Element {
  const { item } = entry
  const meta = [item.status?.label, item.groupTitle].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      data-testid="monday-undated-item"
      data-current={selected ? 'true' : undefined}
      onClick={() => selectMondayItem(item.id)}
      className={cn(
        'flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        selected && 'bg-accent'
      )}
    >
      <span
        className="mt-1 size-2 shrink-0 rounded-full"
        style={{ backgroundColor: item.status?.color ?? 'var(--muted-foreground)' }}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'line-clamp-2 break-words',
            item.status?.isDone && 'text-muted-foreground line-through'
          )}
        >
          {item.name}
        </span>
        {meta ? (
          <span className="block truncate text-[11px] text-muted-foreground">{meta}</span>
        ) : null}
      </span>
    </button>
  )
}

/** Items with no timeline, start or due date, which neither the calendar nor the Gantt can draw. */
export function MondayUndatedPanel({
  entries,
  boardOrder,
  selectedItemId
}: {
  entries: readonly MondayCalendarEntry[]
  boardOrder: readonly string[]
  selectedItemId: string | null
}): React.JSX.Element {
  const groups = useMemo(
    () => groupMondayUndatedEntries(entries, boardOrder),
    [entries, boardOrder]
  )
  const hideLabel = translate('monday.undated.hide', 'Hide items without dates')
  return (
    <aside
      className="flex w-64 shrink-0 flex-col border-r border-border bg-background"
      data-testid="monday-undated-panel"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
        <CalendarOff className="size-3.5 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">
          {translate('monday.undated.title', 'No dates')}
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">{entries.length}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={hideLabel}
              onClick={() => updateMondayPrefs({ showUndated: false })}
            >
              <PanelLeftClose />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {hideLabel}
          </TooltipContent>
        </Tooltip>
      </header>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <section key={group.boardId} className="pb-1">
            {groups.length > 1 ? (
              <h3 className="sticky top-0 z-10 flex border-b border-border bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="truncate">{group.boardName}</span>
                <span className="ml-auto pl-2 tabular-nums">{group.entries.length}</span>
              </h3>
            ) : null}
            {group.entries.map((entry) => (
              <UndatedRow
                key={entry.item.id}
                entry={entry}
                selected={entry.item.id === selectedItemId}
              />
            ))}
          </section>
        ))}
      </div>
    </aside>
  )
}
