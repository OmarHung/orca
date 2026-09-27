import React, { useEffect, useState } from 'react'
import { CircleAlert, CircleSlash, History } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { getIntlLocale, translate } from '@/i18n/i18n'
import type { DatabaseHistoryEntry } from '../../../../../shared/database/database-query-history-types'
import { filterHistory, historyPreview } from './query-history-entries'

type DatabaseQueryHistoryPopoverProps = {
  connectionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Inserts the picked statement; the popover closes itself. */
  onPick: (sql: string) => void
  /** Focus goes back to the console instead of the toolbar button. */
  onClosed: () => void
}

export function historyShortcutKeys(): string[] {
  return navigator.userAgent.includes('Mac') ? ['⌘', '⌥', 'E'] : ['Ctrl', 'Alt', 'E']
}

function entryMeta(entry: DatabaseHistoryEntry): string {
  const at = new Date(entry.at).toLocaleString(getIntlLocale(), {
    dateStyle: 'short',
    timeStyle: 'short'
  })
  return `${at} · ${entry.durationMs.toLocaleString(getIntlLocale())} ms`
}

function OutcomeIcon({ entry }: { entry: DatabaseHistoryEntry }): React.JSX.Element | null {
  if (entry.outcome === 'error') {
    const label = translate('database.history.failed', 'Failed')
    return <CircleAlert className="text-destructive" role="img" aria-label={label} />
  }
  if (entry.outcome === 'cancelled') {
    const label = translate('database.history.cancelled', 'Cancelled')
    return <CircleSlash className="text-muted-foreground" role="img" aria-label={label} />
  }
  return null
}

function ClearHistoryFooter({
  count,
  onClear
}: {
  count: number
  onClear: () => void
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const countText = count.toLocaleString(getIntlLocale())
  return (
    <div className="flex h-9 items-center gap-2 border-t border-border px-3 text-xs text-muted-foreground">
      {confirming ? (
        <>
          <span className="mr-auto">
            {count === 1
              ? translate('database.history.confirmClearOne', 'Clear 1 statement?')
              : translate('database.history.confirmClear', 'Clear {{value0}} statements?', {
                  value0: countText
                })}
          </span>
          <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
            {translate('database.history.cancelClear', 'Cancel')}
          </Button>
          <Button variant="destructive" size="xs" onClick={onClear}>
            {translate('database.history.clear', 'Clear')}
          </Button>
        </>
      ) : (
        <>
          <span className="mr-auto">
            {count === 1
              ? translate('database.history.countOne', '1 statement')
              : translate('database.history.count', '{{value0}} statements', { value0: countText })}
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={count === 0}
            onClick={() => setConfirming(true)}
          >
            {translate('database.history.clearHistory', 'Clear History…')}
          </Button>
        </>
      )}
    </div>
  )
}

// Mounted only while open, so every open starts from a fresh read.
function QueryHistoryList({
  connectionId,
  onPick
}: Pick<DatabaseQueryHistoryPopoverProps, 'connectionId' | 'onPick'>): React.JSX.Element {
  const [entries, setEntries] = useState<DatabaseHistoryEntry[] | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    let current = true
    window.api.database.listHistory(connectionId).then(
      (list) => current && setEntries(Array.isArray(list) ? list : []),
      () => current && setEntries([])
    )
    return () => {
      current = false
    }
  }, [connectionId])

  const visible = entries ? filterHistory(entries, query) : []
  const clear = (): void => {
    window.api.database.clearHistory(connectionId).then(
      () => setEntries([]),
      () => toast.error(translate('database.history.clearFailed', 'Couldn’t clear query history'))
    )
  }
  return (
    // Why jump-palette-command: its selection recipe in main.css stays visible on light popovers.
    <div className="jump-palette-command">
      <Command shouldFilter={false} loop>
        <CommandInput
          autoFocus
          aria-label={translate('database.history.search', 'Search query history')}
          placeholder={translate('database.history.search', 'Search query history')}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList label={translate('database.history.title', 'Query History')}>
          {entries === null ? null : (
            <CommandEmpty>
              {entries.length === 0
                ? translate('database.history.empty', 'Statements you run in consoles appear here.')
                : translate('database.history.noMatches', 'No statements match your search.')}
            </CommandEmpty>
          )}
          {/* History is deduplicated by SQL, so it identifies an entry. */}
          {visible.map((entry) => (
            <CommandItem key={entry.sql} value={entry.sql} onSelect={() => onPick(entry.sql)}>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 break-all font-mono text-xs">
                  {historyPreview(entry.sql)}
                </div>
                <div className="text-xs text-muted-foreground">{entryMeta(entry)}</div>
              </div>
              <OutcomeIcon entry={entry} />
            </CommandItem>
          ))}
        </CommandList>
        {entries === null ? null : <ClearHistoryFooter count={entries.length} onClear={clear} />}
      </Command>
    </div>
  )
}

/** DataGrip's query history: statements run on this connection, newest first. */
export function DatabaseQueryHistoryPopover({
  connectionId,
  open,
  onOpenChange,
  onPick,
  onClosed
}: DatabaseQueryHistoryPopoverProps): React.JSX.Element {
  const label = translate('database.history.title', 'Query History')
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={label}>
              <History />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          <span className="flex items-center gap-2">
            {label}
            <ShortcutKeyCombo keys={historyShortcutKeys()} />
          </span>
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-[min(560px,calc(100vw-2rem))]"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onClosed()
        }}
      >
        <QueryHistoryList
          connectionId={connectionId}
          onPick={(sql) => {
            onOpenChange(false)
            onPick(sql)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
