import React from 'react'
import { Check, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { DatabaseTransactionMode } from '../../../../../shared/database/database-query-types'
import { useDatabasePageStore, type DatabaseConsoleTab } from '../database-page-store'
import { getConsoleRunState, useDatabaseConsoleRunStore } from './database-console-run-store'

type DatabaseTransactionControlsProps = {
  tab: DatabaseConsoleTab
  running: boolean
  /** Runs COMMIT or ROLLBACK on the console's session. */
  onEnd: (statement: 'COMMIT' | 'ROLLBACK') => void
  /** Puts focus back in the console once the mode menu closes. */
  onModeMenuClosed: () => void
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Why a span: a disabled button emits no pointer events, so its tooltip would never open. */}
        <span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** DataGrip's Tx control: auto-commit or manual, with Commit and Roll Back while one is open. */
export function DatabaseTransactionControls({
  tab,
  running,
  onEnd,
  onModeMenuClosed
}: DatabaseTransactionControlsProps): React.JSX.Element {
  const transaction = useDatabaseConsoleRunStore(
    (state) => getConsoleRunState(state.consoles, tab.id).transaction
  )
  const setMode = useDatabasePageStore((state) => state.setTransactionMode)
  const open = transaction !== 'none'
  const showEnd = tab.transactionMode === 'manual' || open
  return (
    <>
      <Select
        value={tab.transactionMode}
        // Why locked while open: leaving manual mode would commit (MySQL) or strand the transaction.
        disabled={open || running}
        onValueChange={(value: DatabaseTransactionMode) => setMode(tab.id, value)}
      >
        <SelectTrigger
          size="sm"
          aria-label={translate('database.transaction.mode', 'Transaction mode')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          // Why: returning focus to the trigger would take it from a console the user already clicked.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            onModeMenuClosed()
          }}
        >
          <SelectItem value="auto">
            {translate('database.transaction.auto', 'Auto-commit')}
          </SelectItem>
          <SelectItem value="manual">
            {translate('database.transaction.manual', 'Manual commit')}
          </SelectItem>
        </SelectContent>
      </Select>
      {showEnd ? (
        <>
          <ToolbarButton
            label={translate('database.transaction.commit', 'Commit')}
            disabled={running || transaction !== 'open'}
            onClick={() => onEnd('COMMIT')}
          >
            <Check />
          </ToolbarButton>
          <ToolbarButton
            label={translate('database.transaction.rollBack', 'Roll Back')}
            disabled={running || !open}
            onClick={() => onEnd('ROLLBACK')}
          >
            <Undo2 />
          </ToolbarButton>
        </>
      ) : null}
      {open ? (
        <Badge variant="outline">
          {transaction === 'failed' ? (
            <>
              <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
              {translate('database.transaction.failed', 'Transaction failed — roll back')}
            </>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-status-warning" aria-hidden="true" />
              {translate('database.transaction.open', 'Transaction open')}
            </>
          )}
        </Badge>
      ) : null}
    </>
  )
}
