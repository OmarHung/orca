import React from 'react'
import { Copy, Download, PanelRight } from 'lucide-react'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import type { DatabaseExportFormat } from '../../../../../shared/database/database-export-types'
import { formatKeybindingList } from '../../../../../shared/keybindings'
import type { GridCopyFormat } from './database-grid-transfer'

const FORMAT_LABELS: Record<DatabaseExportFormat, () => string> = {
  csv: () => translate('database.grid.formatCsv', 'CSV'),
  tsv: () => translate('database.grid.formatTsv', 'TSV'),
  json: () => translate('database.grid.formatJson', 'JSON'),
  sql: () => translate('database.grid.formatSql', 'SQL INSERT')
}
const COPY_AS_FORMATS: DatabaseExportFormat[] = ['csv', 'json', 'sql']
const EXPORT_FORMATS: DatabaseExportFormat[] = ['csv', 'tsv', 'json', 'sql']

function shortcutLabel(binding: string): string {
  return formatKeybindingList([binding], getShortcutPlatform())
}

export function DatabaseGridContextMenu({
  onCopy,
  onExport,
  onShowValue
}: {
  onCopy: (format: GridCopyFormat) => void
  /** Exports every loaded row, not only the selection. */
  onExport: (format: DatabaseExportFormat) => void
  onShowValue: () => void
}): React.JSX.Element {
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => onCopy('tsv')}>
        <Copy />
        {translate('database.grid.copy', 'Copy')}
        <ContextMenuShortcut>{shortcutLabel('Mod+C')}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onCopy('tsv-header')}>
        {translate('database.grid.copyWithHeaders', 'Copy with Headers')}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          {translate('database.grid.copyAs', 'Copy As')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {COPY_AS_FORMATS.map((format) => (
            <ContextMenuItem key={format} onSelect={() => onCopy(format)}>
              {FORMAT_LABELS[format]()}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Download />
          {translate('database.grid.exportLoaded', 'Export Loaded Rows')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {EXPORT_FORMATS.map((format) => (
            <ContextMenuItem key={format} onSelect={() => onExport(format)}>
              {translate('database.grid.exportAs', '{{value0}}…', {
                value0: FORMAT_LABELS[format]()
              })}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onShowValue}>
        <PanelRight />
        {translate('database.grid.showValue', 'Show Value')}
        <ContextMenuShortcut>{shortcutLabel('Shift+Enter')}</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
