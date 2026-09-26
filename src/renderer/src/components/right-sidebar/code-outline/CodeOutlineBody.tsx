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

/** Mounted only while the Structure section is expanded, so a collapsed section parses nothing. */
export function CodeOutlineBody(): React.JSX.Element {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {symbols.length > 0 ? (
        <div className="flex items-center gap-1 px-2 pb-1">
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-sm border border-border bg-input/50 px-1.5 focus-within:border-ring">
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
              {translate(
                'auto.components.rightSidebar.CodeOutlinePanel.collapseAll',
                'Collapse All'
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
      {state.status === 'loading' ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : message ? (
        <div className="flex flex-1 items-center justify-center px-4 py-3 text-center text-xs text-muted-foreground">
          {message}
        </div>
      ) : (
        <div
          ref={listRef}
          role="tree"
          aria-label={translate('auto.components.rightSidebar.CodeOutlinePanel.title', 'Structure')}
          className="scrollbar-sleek min-h-0 flex-1 overflow-auto px-1 pb-1"
        >
          {/* Why: w-max lets long names widen the rows so they scroll instead of truncating. */}
          <div className="w-max min-w-full">
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
        </div>
      )}
    </div>
  )
}
