import React, { useEffect, useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { MONDAY_MAX_SCHEDULE_BOARDS } from '../../../../shared/monday/monday-types'
import { loadMondayBoards, updateMondayPrefs } from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'
import { mondayErrorMessage } from './monday-error-message'

function useBoardNames(): Map<string, string> {
  const boards = useMondayPageStore((state) => state.boards)
  const schedule = useMondayPageStore((state) => state.schedule)
  return useMemo(() => {
    const names = new Map<string, string>()
    schedule?.boards.forEach((board) => names.set(board.boardId, board.boardName))
    boards?.forEach((board) => names.set(board.id, board.name))
    return names
  }, [boards, schedule])
}

function triggerLabel(selected: string[], names: Map<string, string>): string {
  if (selected.length === 0) {
    return translate('monday.boards.choose', 'Choose boards')
  }
  const known = selected.map((id) => names.get(id)).filter((name): name is string => !!name)
  if (known.length === 0) {
    return translate('monday.boards.count', '{{value0}} board(s)', { value0: selected.length })
  }
  const rest = selected.length - 1
  return rest > 0 ? `${known[0]} +${rest}` : known[0]
}

export function MondayBoardPicker(): React.JSX.Element {
  const open = useMondayPageStore((state) => state.boardPickerOpen)
  const boards = useMondayPageStore((state) => state.boards)
  const boardsError = useMondayPageStore((state) => state.boardsError)
  const selected = useMondayPageStore((state) => state.prefs.boardIds)
  const names = useBoardNames()
  const [query, setQuery] = useState('')
  const atLimit = selected.length >= MONDAY_MAX_SCHEDULE_BOARDS

  useEffect(() => {
    if (open && boards === null && boardsError === null) {
      void loadMondayBoards()
    }
  }, [open, boards, boardsError])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (boards ?? []).filter(
      (board) =>
        !needle ||
        board.name.toLowerCase().includes(needle) ||
        (board.workspaceName ?? '').toLowerCase().includes(needle)
    )
  }, [boards, query])

  const setOpen = (next: boolean): void => {
    useMondayPageStore.setState({ boardPickerOpen: next })
    if (!next) {
      setQuery('')
    }
  }

  const toggle = (boardId: string): void => {
    if (selected.includes(boardId)) {
      updateMondayPrefs({ boardIds: selected.filter((id) => id !== boardId) })
    } else if (!atLimit) {
      updateMondayPrefs({ boardIds: [...selected, boardId] })
    }
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
          data-testid="monday-board-picker"
          className="w-56 justify-between"
        >
          <span className="truncate">{triggerLabel(selected, names)}</span>
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            placeholder={translate('monday.boards.search', 'Search boards…')}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {boards === null && !boardsError ? (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {translate('monday.boards.loading', 'Loading boards…')}
              </div>
            ) : null}
            {boardsError ? (
              <div className="space-y-2 px-3 py-3 text-xs">
                <p className="text-destructive">{mondayErrorMessage(boardsError)}</p>
                <Button variant="outline" size="xs" onClick={() => void loadMondayBoards()}>
                  {translate('monday.action.retry', 'Retry')}
                </Button>
              </div>
            ) : null}
            {boards ? (
              <CommandEmpty>{translate('monday.boards.empty', 'No boards match.')}</CommandEmpty>
            ) : null}
            {filtered.map((board) => {
              const isSelected = selected.includes(board.id)
              return (
                <CommandItem
                  key={board.id}
                  value={board.id}
                  disabled={!isSelected && atLimit}
                  onSelect={() => toggle(board.id)}
                >
                  <Check className={cn('size-3.5', isSelected ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0 flex-1 truncate">{board.name}</span>
                  {board.workspaceName ? (
                    <span className="max-w-24 shrink-0 truncate text-muted-foreground">
                      {board.workspaceName}
                    </span>
                  ) : null}
                </CommandItem>
              )
            })}
          </CommandList>
          <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            {translate('monday.boards.limit', '{{value0}} of {{value1}} selected', {
              value0: selected.length,
              value1: MONDAY_MAX_SCHEDULE_BOARDS
            })}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
