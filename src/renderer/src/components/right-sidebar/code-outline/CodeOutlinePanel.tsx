import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ListCollapse, ListFilter, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { CodeOutlineSymbol } from './code-outline-types'
import {
  findActiveSymbolPath,
  flattenCodeOutline,
  symbolKey,
  type CodeOutlineRow
} from './code-outline-tree'
import { CodeOutlineRowButton } from './CodeOutlineRowButton'
import { useCodeOutline, type CodeOutlineState } from './use-code-outline'

const EMPTY_SYMBOLS: CodeOutlineSymbol[] = []

function collectParentKeys(symbols: CodeOutlineSymbol[], parentKey = ''): string[] {
  return symbols.flatMap((symbol, index) => {
    const key = symbolKey(parentKey, index)
    return symbol.children.length > 0 ? [key, ...collectParentKeys(symbol.children, key)] : []
  })
}

function statusMessage(state: CodeOutlineState): string | null {
  switch (state.status) {
    case 'no-file':
      return translate(
        'auto.components.rightSidebar.CodeOutlinePanel.noFile',
        'Open a file in the editor to see its structure.'
      )
    case 'not-loaded':
      return translate(
        'auto.components.rightSidebar.CodeOutlinePanel.notLoaded',
        'Structure appears once the file is shown in the editor.'
      )
    case 'unsupported':
      return translate(
        'auto.components.rightSidebar.CodeOutlinePanel.unsupported',
        'Structure is available for TypeScript, JavaScript, Python and C# files.'
      )
    case 'error':
      return translate(
        'auto.components.rightSidebar.CodeOutlinePanel.error',
        "Couldn't read this file's structure."
      )
    case 'ready':
      return state.symbols.length === 0
        ? translate(
            'auto.components.rightSidebar.CodeOutlinePanel.empty',
            'No symbols in this file.'
          )
        : null
    case 'loading':
      return null
  }
}

export default function CodeOutlinePanel(): React.JSX.Element {
  const { target, state } = useCodeOutline()
  const symbols = state.status === 'ready' ? state.symbols : EMPTY_SYMBOLS
  const cursorLine = useAppStore((s) =>
    target ? (s.editorCursorLine[target.filePath] ?? null) : null
  )
  const setPendingEditorReveal = useAppStore((s) => s.setPendingEditorReveal)
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const filePath = target?.filePath ?? null

  // Why: keys are index paths, so collapse state from another file would point at unrelated symbols.
  useEffect(() => {
    setCollapsedKeys(new Set())
  }, [filePath])

  const rows = useMemo(
    () => flattenCodeOutline(symbols, collapsedKeys, filter),
    [symbols, collapsedKeys, filter]
  )
  const currentKey = useMemo(() => {
    if (cursorLine === null) {
      return null
    }
    const visibleKeys = new Set(rows.map((row) => row.key))
    const path = findActiveSymbolPath(symbols, cursorLine).filter((key) => visibleKeys.has(key))
    return path.at(-1) ?? null
  }, [cursorLine, rows, symbols])

  useEffect(() => {
    if (!currentKey) {
      return
    }
    listRef.current
      ?.querySelector(`[data-outline-key="${currentKey}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [currentKey])

  const handleToggle = useCallback((key: string) => {
    setCollapsedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const handleReveal = useCallback(
    (row: CodeOutlineRow) => {
      if (!target) {
        return
      }
      setPendingEditorReveal({
        filePath: target.filePath,
        fileId: target.fileId,
        line: row.symbol.line,
        column: row.symbol.column,
        matchLength: row.symbol.name.length
      })
    },
    [setPendingEditorReveal, target]
  )

  const canCollapseAll = symbols.some((symbol) => symbol.children.length > 0)
  const message = statusMessage(state)
  const title =
    state.status === 'no-file'
      ? translate('auto.components.rightSidebar.CodeOutlinePanel.title', 'Structure')
      : state.fileName

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-8 min-h-8 items-center gap-2 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={title}>
          {title}
        </span>
        {state.status === 'loading' ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!canCollapseAll}
              aria-label={translate(
                'auto.components.rightSidebar.CodeOutlinePanel.collapseAll',
                'Collapse All'
              )}
              onClick={() => setCollapsedKeys(new Set(collectParentKeys(symbols)))}
            >
              <ListCollapse className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {translate('auto.components.rightSidebar.CodeOutlinePanel.collapseAll', 'Collapse All')}
          </TooltipContent>
        </Tooltip>
      </div>
      {symbols.length > 0 ? (
        <div className="px-2 pt-2">
          <div className="flex h-7 items-center gap-1 rounded-sm border border-border bg-input/50 px-1.5 focus-within:border-ring">
            <ListFilter className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              className="min-w-0 flex-1 bg-transparent py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
              aria-label={translate(
                'auto.components.rightSidebar.CodeOutlinePanel.filter',
                'Filter symbols'
              )}
              placeholder={translate(
                'auto.components.rightSidebar.CodeOutlinePanel.filter',
                'Filter symbols'
              )}
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
              spellCheck={false}
            />
            {filter ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate(
                  'auto.components.rightSidebar.CodeOutlinePanel.clearFilter',
                  'Clear filter'
                )}
                onClick={() => setFilter('')}
              >
                <X className="size-3" />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {message ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          {message}
        </div>
      ) : (
        <div
          ref={listRef}
          role="tree"
          aria-label={translate('auto.components.rightSidebar.CodeOutlinePanel.title', 'Structure')}
          className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-1"
        >
          {rows.map((row) => (
            <CodeOutlineRowButton
              key={row.key}
              row={row}
              isCurrent={row.key === currentKey}
              onToggle={handleToggle}
              onReveal={handleReveal}
            />
          ))}
        </div>
      )}
    </div>
  )
}
