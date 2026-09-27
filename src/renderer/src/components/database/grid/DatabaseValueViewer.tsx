import React from 'react'
import { Copy, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { translate } from '@/i18n/i18n'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import type {
  DatabaseCell,
  DatabaseColumn
} from '../../../../../shared/database/database-query-types'
import { formatKeybinding } from '../../../../../shared/keybindings'
import { ResizeHandle } from '../../bottom-panel/ResizeHandle'
import { useDragResize } from '../../bottom-panel/use-drag-resize'
import { DATABASE_VALUE_VIEWER_WIDTH, useDatabasePageStore } from '../database-page-store'
import { viewerValue, type ViewerValue } from './database-value-format'

export function DatabaseValueViewerToggle(): React.JSX.Element {
  const open = useDatabasePageStore((state) => state.valueViewerOpen)
  const toggle = useDatabasePageStore((state) => state.toggleValueViewer)
  const label = translate('database.viewer.toggle', 'Value viewer')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={open ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={label}
          aria-pressed={open}
          onClick={toggle}
        >
          <PanelRight />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <span className="flex items-center gap-2">
          {label}
          <ShortcutKeyCombo keys={formatKeybinding('Shift+Enter', getShortcutPlatform())} />
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function ViewerBody({ value }: { value: ViewerValue | null }): React.JSX.Element {
  if (!value) {
    return (
      <p className="p-2 text-xs text-muted-foreground">
        {translate('database.viewer.empty', 'Select a cell to see its value.')}
      </p>
    )
  }
  if (value.kind === 'null') {
    return (
      <span className="block p-2 font-mono text-xs italic text-muted-foreground">
        {translate('database.grid.null', 'NULL')}
      </span>
    )
  }
  return (
    <>
      <pre className="whitespace-pre-wrap break-all p-2 font-mono text-xs text-foreground">
        {value.text}
      </pre>
      {value.truncatedFrom !== null ? (
        <p className="border-t border-border px-2 py-1 text-xs text-muted-foreground">
          {translate(
            'database.grid.truncated',
            'Showing the first {{value0}} of {{value1}} characters',
            {
              value0: value.text.length.toLocaleString(),
              value1: value.truncatedFrom.toLocaleString()
            }
          )}
        </p>
      ) : null}
    </>
  )
}

/** Full value of the focused cell, beside the grid. */
export function DatabaseValueViewer({
  column,
  cell
}: {
  column: DatabaseColumn | null
  cell: DatabaseCell
}): React.JSX.Element {
  const width = useDatabasePageStore((state) => state.valueViewerWidth)
  const setWidth = useDatabasePageStore((state) => state.setValueViewerWidth)
  const { size, handleProps } = useDragResize({
    axis: 'x',
    size: width,
    setSize: setWidth,
    min: DATABASE_VALUE_VIEWER_WIDTH.min,
    getMax: () => DATABASE_VALUE_VIEWER_WIDTH.max,
    direction: -1
  })
  const value = column ? viewerValue(cell, column) : null
  return (
    <aside
      aria-label={translate('database.viewer.toggle', 'Value viewer')}
      className="relative flex shrink-0 flex-col border-l border-border bg-background"
      style={{ width: size }}
    >
      <ResizeHandle
        edge="left"
        label={translate('database.viewer.resize', 'Resize value viewer')}
        handleProps={handleProps}
      />
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2 text-xs">
        <span className="truncate font-medium text-foreground">
          {column?.name ?? translate('database.viewer.title', 'Value')}
        </span>
        {column ? <span className="truncate text-muted-foreground">{column.typeName}</span> : null}
        {value?.kind === 'text' ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label={translate('database.viewer.copy', 'Copy value')}
            onClick={() => void window.api.ui.writeClipboardText(value.text)}
          >
            <Copy />
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-editor">
        <ViewerBody value={value} />
      </div>
    </aside>
  )
}
