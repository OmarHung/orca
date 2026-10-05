import React from 'react'
import {
  CalendarDays,
  CalendarRange,
  ChartGantt,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LogOut,
  RotateCw,
  UserRound
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { MondayAccount } from '../../../../shared/monday/monday-types'
import { formatMondayMonth } from './monday-date-format'
import {
  disconnectMonday,
  refreshMonday,
  shiftMondayMonth,
  showMondayToday,
  updateMondayPrefs
} from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'
import { MondayBoardPicker } from './MondayBoardPicker'
import { MondayPersonPicker } from './MondayPersonPicker'

function LabeledSwitch(props: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5">
          <Switch id={props.id} checked={props.checked} onCheckedChange={props.onChange} />
          <label htmlFor={props.id} className="cursor-pointer text-xs">
            {props.label}
          </label>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {props.hint}
      </TooltipContent>
    </Tooltip>
  )
}

function IconButton(props: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={props.label}
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {props.label}
      </TooltipContent>
    </Tooltip>
  )
}

function AccountMenu({
  account,
  sessionOnly
}: {
  account: MondayAccount
  sessionOnly: boolean
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={translate('monday.account.menu', 'monday account')}
        >
          <UserRound />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="space-y-0.5">
            <div className="truncate text-sm">{account.userName}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">
              {account.email} · {account.accountName}
            </div>
            {sessionOnly ? (
              <div className="text-xs font-normal text-muted-foreground">
                {translate(
                  'monday.account.sessionOnly',
                  'No system keychain: the token is kept only until Orca quits.'
                )}
              </div>
            ) : null}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            void window.api.shell.openUrl(`https://${account.accountSlug}.monday.com`)
          }
        >
          <ExternalLink />
          {translate('monday.account.open', 'Open monday')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void disconnectMonday()}>
          <LogOut />
          {translate('monday.account.disconnect', 'Disconnect')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function MondayToolbar({
  account,
  sessionOnly
}: {
  account: MondayAccount
  sessionOnly: boolean
}): React.JSX.Element {
  const prefs = useMondayPageStore((state) => state.prefs)
  const anchorMonth = useMondayPageStore((state) => state.anchorMonth)
  const loading = useMondayPageStore((state) => state.scheduleLoading)
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
          <CalendarRange className="size-4 text-muted-foreground" />
        </div>
        <h1 className="text-sm font-semibold">{translate('monday.page.title', 'monday')}</h1>
      </div>
      <MondayBoardPicker />
      <MondayPersonPicker account={account} />
      <LabeledSwitch
        id="monday-hide-done"
        label={translate('monday.filter.hideDone', 'Hide done')}
        hint={translate('monday.filter.hideDoneHint', 'Hide items whose status is marked done')}
        checked={prefs.hideDone}
        onChange={(hideDone) => updateMondayPrefs({ hideDone })}
      />
      <div className="ml-auto flex items-center gap-1">
        <IconButton
          label={translate('monday.nav.previous', 'Previous month')}
          onClick={() => shiftMondayMonth(-1)}
        >
          <ChevronLeft />
        </IconButton>
        <Button variant="outline" size="sm" onClick={showMondayToday}>
          {translate('monday.nav.today', 'Today')}
        </Button>
        <IconButton
          label={translate('monday.nav.next', 'Next month')}
          onClick={() => shiftMondayMonth(1)}
        >
          <ChevronRight />
        </IconButton>
        <span
          className="w-28 text-center text-sm font-semibold tabular-nums"
          data-testid="monday-month-label"
        >
          {formatMondayMonth(anchorMonth)}
        </span>
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={prefs.view}
        onValueChange={(value) => {
          if (value === 'month' || value === 'gantt') {
            updateMondayPrefs({ view: value })
          }
        }}
      >
        <ToggleGroupItem value="month">
          <CalendarDays className="size-3.5" />
          {translate('monday.view.month', 'Calendar')}
        </ToggleGroupItem>
        <ToggleGroupItem value="gantt">
          <ChartGantt className="size-3.5" />
          {translate('monday.view.gantt', 'Gantt')}
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="flex items-center gap-1">
        <IconButton
          label={translate('monday.action.refresh', 'Refresh from monday')}
          disabled={loading || prefs.boardIds.length === 0}
          onClick={() => void refreshMonday()}
        >
          <RotateCw className={cn(loading && 'animate-spin')} />
        </IconButton>
        <AccountMenu account={account} sessionOnly={sessionOnly} />
      </div>
    </div>
  )
}
