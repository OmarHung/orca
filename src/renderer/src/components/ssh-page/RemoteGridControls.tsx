import { LayoutGrid, Plus, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

function StripButton({
  label,
  dataAttr,
  isPressed,
  disabled,
  onClick,
  children
}: {
  label: string
  dataAttr: string
  isPressed?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={isPressed ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={label}
          aria-pressed={isPressed}
          disabled={disabled}
          data-remote-grid-control={dataAttr}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** In the tab strip: start a grid, add to it, go back to it, or end it. */
export function RemoteGridControls({
  hasGrid,
  isGridShown,
  hasTabs,
  onAdd,
  onReturn,
  onEnd
}: {
  hasGrid: boolean
  /** False while a tab outside the grid is on screen. */
  isGridShown: boolean
  hasTabs: boolean
  onAdd: () => void
  onReturn: () => void
  onEnd: () => void
}): React.JSX.Element {
  if (!hasGrid) {
    return (
      <StripButton
        label={translate('sshPage.grid.start', 'Show side by side')}
        dataAttr="start"
        disabled={!hasTabs}
        onClick={onAdd}
      >
        <LayoutGrid className="size-3.5" />
      </StripButton>
    )
  }
  if (!isGridShown) {
    return (
      <StripButton
        label={translate('sshPage.grid.return', 'Back to the grid')}
        dataAttr="return"
        onClick={onReturn}
      >
        <LayoutGrid className="size-3.5" />
      </StripButton>
    )
  }
  return (
    <>
      <StripButton
        label={translate('sshPage.grid.add', 'Add a connection')}
        dataAttr="add"
        onClick={onAdd}
      >
        <Plus className="size-3.5" />
      </StripButton>
      <StripButton
        label={translate('sshPage.grid.end', 'End the grid. Tabs and connections stay open.')}
        dataAttr="end"
        isPressed
        onClick={onEnd}
      >
        <LayoutGrid className="size-3.5" />
      </StripButton>
    </>
  )
}

/** Says a grid is waiting while a tab outside it is on screen, in every layout. */
export function RemoteGridHint({
  onAddCurrent,
  onReturn
}: {
  onAddCurrent: () => void
  onReturn: () => void
}): React.JSX.Element {
  return (
    <div
      role="status"
      data-remote-grid-hint
      className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-1 text-xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1 truncate">
        {translate('sshPage.grid.outside', 'This tab isn’t in the grid.')}
      </span>
      <Button variant="ghost" size="xs" data-remote-grid-hint-add onClick={onAddCurrent}>
        {translate('sshPage.grid.addCurrent', 'Add to grid')}
      </Button>
      <Button variant="ghost" size="xs" data-remote-grid-hint-return onClick={onReturn}>
        {translate('sshPage.grid.return', 'Back to the grid')}
      </Button>
    </div>
  )
}

/** Under the host list while hosts are picked with ⌘/Ctrl. */
export function RemoteHostSelectionBar({
  count,
  hasGrid,
  onOpen,
  onClear
}: {
  count: number
  hasGrid: boolean
  onOpen: () => void
  onClear: () => void
}): React.JSX.Element {
  return (
    <div
      data-ssh-host-selection
      className="flex shrink-0 items-center gap-1 border-t border-border p-2"
    >
      <Button size="xs" className="min-w-0 flex-1" data-ssh-host-selection-open onClick={onOpen}>
        <span className="truncate">
          {hasGrid
            ? translate('sshPage.grid.addSelected', 'Add {{count}} to grid', { count })
            : translate('sshPage.grid.openSelected', 'Open {{count}} side by side', { count })}
        </span>
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={translate('sshPage.grid.clearSelection', 'Clear selection')}
        onClick={onClear}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
