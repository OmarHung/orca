import React, { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Copy, Undo2, X, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { useShortcutKeyDetails } from '@/hooks/useShortcutLabel'
import type { KeybindingActionId } from '../../../../../shared/keybindings'
import { translate } from '@/i18n/i18n'
import type { ChangeMarkerKind } from './change-marker-hunks'

const COPIED_FEEDBACK_MS = 1500

export type ChangeMarkerPeekToolbarProps = {
  kind: ChangeMarkerKind
  position: number
  total: number
  canRollback: boolean
  onPrevious: () => void
  onNext: () => void
  onRollback: () => void
  /** Resolves true once the clipboard holds the text; null hides the button. */
  onCopy: (() => Promise<boolean>) | null
  onClose: () => void
}

function kindLabel(kind: ChangeMarkerKind): string {
  if (kind === 'added') {
    return translate('changeMarkers.kind.added', 'Added')
  }
  if (kind === 'deleted') {
    return translate('changeMarkers.kind.deleted', 'Deleted')
  }
  return translate('changeMarkers.kind.modified', 'Modified')
}

function ToolbarButton({
  icon: Icon,
  label,
  shortcutActionId,
  disabled = false,
  onClick
}: {
  icon: LucideIcon
  label: string
  shortcutActionId?: KeybindingActionId
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
        {shortcutActionId ? <ToolbarShortcut actionId={shortcutActionId} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

function ToolbarShortcut({ actionId }: { actionId: KeybindingActionId }): React.JSX.Element | null {
  const shortcut = useShortcutKeyDetails(actionId)
  if (shortcut.keys.length === 0) {
    return null
  }
  return <ShortcutKeyCombo keys={shortcut.keys} doubleTap={shortcut.doubleTap} className="ml-1.5" />
}

export function ChangeMarkerPeekToolbar({
  kind,
  position,
  total,
  canRollback,
  onPrevious,
  onNext,
  onRollback,
  onCopy,
  onClose
}: ChangeMarkerPeekToolbarProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    // Why: this toolbar mounts in its own React root inside a Monaco view zone,
    // outside the app-level tooltip provider.
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full items-center gap-0.5 whitespace-nowrap px-1 text-[11px] text-muted-foreground">
        <ToolbarButton
          icon={ArrowUp}
          label={translate(
            'auto.components.editor.EditorPanelHeader.2076ecfc9c',
            'Previous change'
          )}
          shortcutActionId="editor.previousChange"
          disabled={total < 2}
          onClick={onPrevious}
        />
        <ToolbarButton
          icon={ArrowDown}
          label={translate('auto.components.editor.EditorPanelHeader.631dab0df3', 'Next change')}
          shortcutActionId="editor.nextChange"
          disabled={total < 2}
          onClick={onNext}
        />
        <span className="px-1.5 font-medium text-foreground/80">{kindLabel(kind)}</span>
        <span className="pr-1.5 tabular-nums">
          {position} / {total}
        </span>
        <ToolbarButton
          icon={Undo2}
          label={translate('changeMarkers.rollback', 'Roll back change')}
          disabled={!canRollback}
          onClick={onRollback}
        />
        {onCopy ? (
          <ToolbarButton
            icon={copied ? Check : Copy}
            label={
              copied
                ? translate('changeMarkers.copied', 'Copied')
                : translate('changeMarkers.copyOriginal', 'Copy original lines')
            }
            onClick={() => {
              void onCopy().then(setCopied)
            }}
          />
        ) : null}
        <ToolbarButton
          icon={X}
          label={translate('changeMarkers.close', 'Close')}
          onClick={onClose}
        />
      </div>
    </TooltipProvider>
  )
}
