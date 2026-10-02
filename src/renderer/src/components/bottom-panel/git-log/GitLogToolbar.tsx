import React from 'react'
import { Cherry, ChevronDown, GitBranch, RefreshCw, Search, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { GitLogFilter } from './git-log-filter'

const ALL_AUTHORS_VALUE = '__all__'

function GitLogAuthorFilter({
  authors,
  value,
  onChange
}: {
  authors: readonly string[]
  value: string | null
  onChange: (author: string | null) => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs">
          <User />
          <span className="max-w-[8rem] truncate">
            {value ?? translate('bottomPanel.gitLog.userFilter', 'User')}
          </span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72">
        <DropdownMenuRadioGroup
          value={value ?? ALL_AUTHORS_VALUE}
          onValueChange={(next) => onChange(next === ALL_AUTHORS_VALUE ? null : next)}
        >
          <DropdownMenuRadioItem value={ALL_AUTHORS_VALUE}>
            {translate('bottomPanel.gitLog.allUsers', 'All users')}
          </DropdownMenuRadioItem>
          {authors.length > 0 ? <DropdownMenuSeparator /> : null}
          {authors.map((author) => (
            <DropdownMenuRadioItem key={author} value={author}>
              {author}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** JetBrains' "Highlight non-picked commits": only meaningful for one chosen non-current branch. */
function GitLogCherryPickToggle({
  available,
  pressed,
  onPressedChange
}: {
  available: boolean
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
}): React.JSX.Element {
  const label = available
    ? translate('bottomPanel.gitLog.markCherryPicks', 'Highlight commits already cherry-picked')
    : translate(
        'bottomPanel.gitLog.markCherryPicksUnavailable',
        'Select a branch to compare with the current branch'
      )
  return (
    <Button
      variant={available && pressed ? 'secondary' : 'ghost'}
      size="icon-xs"
      aria-label={label}
      aria-pressed={available && pressed}
      title={label}
      disabled={!available}
      data-testid="git-log-cherry-pick-toggle"
      onClick={() => onPressedChange(!pressed)}
    >
      <Cherry />
    </Button>
  )
}

type GitLogToolbarProps = {
  filter: GitLogFilter
  onFilterChange: (update: (prev: GitLogFilter) => GitLogFilter) => void
  authors: readonly string[]
  scopeLabel: string | undefined
  cherryPicks: { available: boolean; pressed: boolean; onPressedChange: (pressed: boolean) => void }
  loading: boolean
  onRefresh: () => void
}

export function GitLogToolbar({
  filter,
  onFilterChange,
  authors,
  scopeLabel,
  cherryPicks,
  loading,
  onRefresh
}: GitLogToolbarProps): React.JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
      <div className="flex h-6 w-64 min-w-0 items-center gap-1.5 rounded-md border border-input px-2 focus-within:border-ring">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={filter.text}
          onChange={(event) => {
            const text = event.target.value
            onFilterChange((prev) => ({ ...prev, text }))
          }}
          placeholder={translate('bottomPanel.gitLog.searchPlaceholder', 'Text or hash')}
          aria-label={translate('bottomPanel.gitLog.searchPlaceholder', 'Text or hash')}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
        />
        {filter.text ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={translate('bottomPanel.gitLog.clearSearch', 'Clear search')}
            onClick={() => onFilterChange((prev) => ({ ...prev, text: '' }))}
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
      <GitLogAuthorFilter
        authors={authors}
        value={filter.author}
        onChange={(author) => onFilterChange((prev) => ({ ...prev, author }))}
      />
      {scopeLabel ? (
        <span
          className="ml-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
          data-testid="git-log-scope-label"
        >
          <GitBranch className="size-3.5 shrink-0" />
          <span className="truncate">{scopeLabel}</span>
        </span>
      ) : null}
      <div className="flex-1" />
      <GitLogCherryPickToggle {...cherryPicks} />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={translate('bottomPanel.gitLog.refresh', 'Refresh log')}
        title={translate('bottomPanel.gitLog.refresh', 'Refresh log')}
        onClick={onRefresh}
      >
        <RefreshCw className={cn(loading && 'animate-spin')} />
      </Button>
    </div>
  )
}
