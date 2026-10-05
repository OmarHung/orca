import React, { useEffect, useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { MondayAccount, MondayUser } from '../../../../shared/monday/monday-types'
import { mondayErrorMessage } from './monday-error-message'
import { loadMondayUsers, resolveMondayPersonId, updateMondayPrefs } from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'

const EVERYONE = '__everyone__'

/** The token's own account first, then everyone else by name. */
function orderedUsers(users: MondayUser[], accountId: string): MondayUser[] {
  const own = users.filter((user) => user.id === accountId)
  const others = users
    .filter((user) => user.id !== accountId)
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...own, ...others]
}

function personLabel(
  personId: string | null,
  users: MondayUser[] | null,
  account: MondayAccount
): string {
  if (personId === null) {
    return translate('monday.person.everyone', 'Everyone')
  }
  if (personId === account.userId) {
    return account.userName
  }
  return users?.find((user) => user.id === personId)?.name ?? '…'
}

export function MondayPersonPicker({ account }: { account: MondayAccount }): React.JSX.Element {
  const prefs = useMondayPageStore((state) => state.prefs)
  const connection = useMondayPageStore((state) => state.connection)
  const users = useMondayPageStore((state) => state.users)
  const usersError = useMondayPageStore((state) => state.usersError)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const personId = resolveMondayPersonId(prefs, connection)
  // The trigger needs the name of someone other than the token's account.
  const needsUsers = open || (personId !== null && personId !== account.userId)

  useEffect(() => {
    if (needsUsers && users === null && usersError === null) {
      void loadMondayUsers()
    }
  }, [needsUsers, users, usersError])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return orderedUsers(users ?? [], account.userId).filter(
      (user) =>
        !needle ||
        user.name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle)
    )
  }, [users, query, account.userId])

  const choose = (value: string): void => {
    updateMondayPrefs({ personId: value === EVERYONE ? null : value })
    setOpen(false)
    setQuery('')
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
          data-testid="monday-person-picker"
          className="max-w-56 justify-between"
        >
          <Users className="size-3.5" />
          <span className="truncate">
            {translate('monday.person.trigger', 'Show: {{value0}}', {
              value0: personLabel(personId, users, account)
            })}
          </span>
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            placeholder={translate('monday.person.search', 'Search people…')}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandGroup>
              <CommandItem value={EVERYONE} onSelect={choose}>
                <Check
                  className={cn('size-3.5', personId === null ? 'opacity-100' : 'opacity-0')}
                />
                {translate('monday.person.everyone', 'Everyone')}
              </CommandItem>
              {visible.map((user) => (
                <CommandItem key={user.id} value={user.id} onSelect={choose}>
                  <Check
                    className={cn('size-3.5', personId === user.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="min-w-0 flex-1 truncate">{user.name}</span>
                  <span className="max-w-32 shrink-0 truncate text-muted-foreground">
                    {user.id === account.userId
                      ? translate('monday.person.tokenAccount', 'token account')
                      : user.email}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {users === null && !usersError ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {translate('monday.person.loading', 'Loading people…')}
              </div>
            ) : null}
            {usersError ? (
              <div className="space-y-2 px-3 py-3 text-xs">
                <p className="text-destructive">{mondayErrorMessage(usersError)}</p>
                <Button variant="outline" size="xs" onClick={() => void loadMondayUsers()}>
                  {translate('monday.action.retry', 'Retry')}
                </Button>
              </div>
            ) : null}
          </CommandList>
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <Switch
              id="monday-include-unassigned"
              checked={prefs.includeUnassigned}
              disabled={personId === null}
              onCheckedChange={(includeUnassigned) => updateMondayPrefs({ includeUnassigned })}
            />
            <label htmlFor="monday-include-unassigned" className="cursor-pointer text-xs">
              {translate('monday.person.includeUnassigned', 'Also show items with no one assigned')}
            </label>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
