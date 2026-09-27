import React from 'react'
import { FileCode2, Lock, Minus, Plus, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getIntlLocale, translate } from '@/i18n/i18n'

function IconAction({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Row editing actions for a table tab, or why the table can't be edited. */
export function DatabaseTableEditControls({
  lockReason,
  pendingCount,
  submitting,
  hasSelection,
  onAddRow,
  onDeleteRows,
  onRevertAll,
  onPreview,
  onSubmit
}: {
  lockReason: string | null
  pendingCount: number
  submitting: boolean
  hasSelection: boolean
  onAddRow: () => void
  onDeleteRows: () => void
  onRevertAll: () => void
  onPreview: () => void
  onSubmit: () => void
}): React.JSX.Element {
  if (lockReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
          >
            <Lock className="size-3.5" />
            {translate('database.edit.locked', 'Read-only')}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {lockReason}
        </TooltipContent>
      </Tooltip>
    )
  }
  const pending = pendingCount > 0
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconAction label={translate('database.edit.addRow', 'Add Row')} onClick={onAddRow}>
        <Plus />
      </IconAction>
      <IconAction
        label={translate('database.edit.deleteRows', 'Delete Selected Rows')}
        disabled={!hasSelection}
        onClick={onDeleteRows}
      >
        <Minus />
      </IconAction>
      {pending ? (
        <>
          <IconAction
            label={translate('database.edit.revertAll', 'Revert All Changes')}
            onClick={onRevertAll}
          >
            <Undo2 />
          </IconAction>
          <IconAction label={translate('database.edit.preview', 'Preview SQL')} onClick={onPreview}>
            <FileCode2 />
          </IconAction>
          <Button size="sm" disabled={submitting} onClick={onSubmit}>
            {translate('database.edit.submitCount', 'Submit {{value0}}', {
              value0: pendingCount.toLocaleString(getIntlLocale())
            })}
          </Button>
        </>
      ) : null}
    </div>
  )
}
